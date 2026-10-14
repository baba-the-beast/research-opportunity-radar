import { NextRequest } from 'next/server';
import { getOwnProfileId, getRequestSupabase, requireUserAccount, UUID_PATTERN } from '@/lib/routeContext';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { consumeRateLimit, rateLimitKey } from '@/lib/rateLimit';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';
import { z } from 'zod';
import { TRACK_STATUSES } from '@/lib/applications';
import { DISMISSAL_MARKER, DISMISS_REASON_VALUES, LEGACY_DISMISSAL_TEXT, PENALISING_REASON, suggestTopicTerms } from '@/lib/feedback';

const statusSchema = z.object({
  status: z.enum(TRACK_STATUSES),
  // Why a call was dismissed; omitted by older clients, which keeps the old topic penalty
  reason: z.enum(DISMISS_REASON_VALUES).optional(),
  feedback_text: z.string().max(2000).optional(),
  negative_terms: z.array(z.string().trim().min(1).max(100)).max(25).optional()
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params; // Next 15: params is async
  try {
    // 1. Authentication
    const auth = await authenticateRequest(req);
    if (!auth.authenticated || !auth.user?.id) {
      return auth.errorResponse!;
    }

    const noAccount = requireUserAccount(auth.user, req);
    if (noAccount) {
      return noAccount;
    }

    // 2. Authorization
    const roleCheck = authorizeRole(auth.user, ['faculty', 'operator', 'admin']);
    if (!roleCheck.authorized) {
      return roleCheck.errorResponse!;
    }

    // 3. Sanitized Rate Limiting
    const ip = rateLimitKey(req, auth.user);
    const rateCheck = await consumeRateLimit(`status_${ip}`, 20, 60000);
    if (!rateCheck.allowed) {
      return createErrorResponse(
        'RATE_LIMIT_EXCEEDED',
        'Rate limit exceeded: Too many status update requests.',
        429,
        req
      );
    }

    const id = rawId?.trim();
    if (!id || !UUID_PATTERN.test(id)) {
      return createErrorResponse('INVALID_IDENTIFIER', 'Invalid opportunity identifier format', 400, req);
    }

    const body = await req.json();
    const parsed = statusSchema.safeParse(body);
    if (!parsed.success) {
      return createErrorResponse('VALIDATION_ERROR', 'Invalid status payload', 400, req, parsed.error.issues);
    }

    const supabase = getRequestSupabase(auth.user);

    // Dismissal feedback only changes when a call is dismissed or un-dismissed, so other moves
    // (e.g. pursuing -> applied) skip the feedback round trips below
    const { data: prev } = await supabase
      .from('user_opportunity_state')
      .select('status')
      .eq('user_id', auth.user!.id)
      .eq('opportunity_id', id)
      .maybeSingle();
    const touchesDismissal = parsed.data.status === 'dismissed' || prev?.status === 'dismissed';

    // Per-user tracking state. (The legacy opportunity_status table is keyed by opportunity_id
    // alone, so writing it let one user's status overwrite another's; it is no longer used.)
    const { error: stateErr } = await supabase
      .from('user_opportunity_state')
      .upsert({
        user_id: auth.user!.id,
        opportunity_id: id,
        status: parsed.data.status,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,opportunity_id' });
    if (stateErr) {
      return createErrorResponse('DATABASE_ERROR', stateErr.message, 500, req);
    }

    const { error: activityErr } = await supabase.from('user_activity').insert({
      user_id: auth.user!.id,
      event_type: 'status_change',
      title: `Call marked as ${parsed.data.status.replace('_', ' ')}`,
      description: `Status of opportunity ${id} changed to ${parsed.data.status}.`,
      metadata: { opportunity_id: id, new_status: parsed.data.status }
    });
    if (activityErr) {
      console.error('user_activity insert failed:', activityErr.message);
    }

    // Feedback loop. Only "not my research area" lowers similar calls; other reasons are kept as
    // neutral feedback. Any dismissal feedback for this call is replaced on re-dismiss and removed
    // when the call is un-dismissed, so the penalty never outlives the decision.
    const profileId = touchesDismissal ? await getOwnProfileId(supabase, auth.user) : null;
    let feedbackCleared = true;
    if (profileId) {
      // PostgREST: values with ':' or spaces must be double-quoted inside or()
      const dismissalFilter = `feedback_text.like."${DISMISSAL_MARKER}*",feedback_text.eq."${LEGACY_DISMISSAL_TEXT}"`;
      const { data: existing } = await supabase
        .from('feedback')
        .select('id')
        .eq('opportunity_id', id)
        .eq('faculty_id', profileId)
        .in('rating', ['not_relevant', 'neutral'])
        .or(dismissalFilter);
      if (existing && existing.length > 0) {
        const { data: deleted, error: clearErr } = await supabase
          .from('feedback')
          .delete()
          .in('id', existing.map((r) => r.id))
          .select('id');
        // Without a delete policy (migration 20261008000200 not applied) RLS deletes nothing and
        // still reports success, so compare counts instead of relying on an error
        if (clearErr || (deleted?.length ?? 0) < existing.length) {
          feedbackCleared = false;
          console.error(
            'feedback clear failed; apply migration 20261008000200_feedback_undo.sql:',
            clearErr?.message ?? `deleted ${deleted?.length ?? 0} of ${existing.length} rows`
          );
        }
      }

      // If the old dismissal could not be removed it still applies; adding another would double the penalty
      if (parsed.data.status === 'dismissed' && feedbackCleared) {
        const reason = parsed.data.reason ?? PENALISING_REASON;
        const penalise = reason === PENALISING_REASON;
        let negativeTerms = penalise ? parsed.data.negative_terms || [] : [];
        // Old clients send no terms: fall back to the call's distinctive title words
        if (penalise && negativeTerms.length === 0 && parsed.data.negative_terms === undefined) {
          const { data: oppData } = await supabase.from('opportunities').select('title').eq('id', id).single();
          negativeTerms = oppData?.title ? suggestTopicTerms(oppData.title) : [];
        }
        const note = parsed.data.feedback_text?.trim();
        const { error: fbErr } = await supabase.from('feedback').insert({
          opportunity_id: id,
          faculty_id: profileId,
          rating: penalise && negativeTerms.length > 0 ? 'not_relevant' : 'neutral',
          feedback_text: `${DISMISSAL_MARKER}${reason}]${note ? ` ${note}` : ''}`,
          negative_terms: negativeTerms
        });
        if (fbErr) {
          return createErrorResponse('DATABASE_ERROR', fbErr.message, 500, req);
        }
      }
    }

    return createSuccessResponse({ status: parsed.data.status, feedback_cleared: feedbackCleared }, req);
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
