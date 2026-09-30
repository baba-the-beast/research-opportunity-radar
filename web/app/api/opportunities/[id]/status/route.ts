import { NextRequest } from 'next/server';
import { getOwnProfileId, getRequestSupabase, requireUserAccount, UUID_PATTERN } from '@/lib/routeContext';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { consumeRateLimit, rateLimitKey } from '@/lib/rateLimit';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';
import { z } from 'zod';

const statusSchema = z.object({
  status: z.enum(['new', 'pursuing', 'dismissed']),
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
      title: `Marked Opportunity as ${parsed.data.status.toUpperCase()}`,
      description: `Investigator transitioned opportunity ${id} to ${parsed.data.status}.`,
      metadata: { opportunity_id: id, new_status: parsed.data.status }
    });
    if (activityErr) {
      console.error('user_activity insert failed:', activityErr.message);
    }

    // Feedback loop: a dismissal becomes a not_relevant signal for this faculty's own scoring
    if (parsed.data.status === 'dismissed') {
      const profileId = await getOwnProfileId(supabase, auth.user);
      if (profileId) {
        let negativeTerms = parsed.data.negative_terms || [];
        if (negativeTerms.length === 0) {
          const { data: oppData } = await supabase
            .from('opportunities')
            .select('title')
            .eq('id', id)
            .single();
          if (oppData?.title) {
            const words = oppData.title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w: string) => w.length > 3);
            const stopWords = new Set(['with', 'from', 'this', 'that', 'call', 'proposals', 'special', 'issue', 'journal', 'research']);
            negativeTerms = Array.from(new Set(words.filter((w: string) => !stopWords.has(w)))).slice(0, 5) as string[];
          }
        }

        const { error: fbErr } = await supabase.from('feedback').insert({
          opportunity_id: id,
          faculty_id: profileId,
          rating: 'not_relevant',
          feedback_text: parsed.data.feedback_text || 'Dismissed by faculty',
          negative_terms: negativeTerms
        });
        if (fbErr) {
          return createErrorResponse('DATABASE_ERROR', fbErr.message, 500, req);
        }
      }
    }

    return createSuccessResponse({ status: parsed.data.status }, req);
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
