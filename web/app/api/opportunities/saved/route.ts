import { NextRequest } from 'next/server';
import { getRequestSupabase, hasUserAccount, requireUserAccount, UUID_PATTERN } from '@/lib/routeContext';
import { authenticateRequest } from '@/lib/auth';
import { consumeRateLimit, getClientIp } from '@/lib/rateLimit';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const saveSchema = z.object({
  opportunity_id: z.string().trim().regex(UUID_PATTERN, 'must be an opportunity UUID'),
  saved: z.boolean(),
  notes: z.string().max(2000).optional()
});

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated || !auth.user?.id) {
      return auth.errorResponse!;
    }

    if (!hasUserAccount(auth.user)) {
      return createSuccessResponse({ data: [], total: 0 }, req);
    }

    const supabase = getRequestSupabase(auth.user);

    const { data: savedRows, error } = await supabase
      .from('user_opportunity_state')
      .select(`
        opportunity_id, status, saved, notes, personal_score, updated_at,
        opportunities (
          id, kind, title, summary, agency_or_publisher, venue_name, doi, status,
          opportunity_deadlines (id, deadline_type, deadline_date, confidence),
          opportunity_sources (source_url, sources (name))
        )
      `)
      .eq('user_id', auth.user.id)
      .eq('saved', true)
      .order('updated_at', { ascending: false });

    if (error) {
      return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
    }
    const rowsToFormat = savedRows || [];

    const formatted = rowsToFormat.map((row: any) => {
      const opp = row.opportunities;
      const dls = opp?.opportunity_deadlines || [];
      const src = opp?.opportunity_sources?.[0];

      return {
        id: row.opportunity_id,
        kind: opp?.kind || 'funding',
        title: opp?.title || 'Untitled Opportunity',
        summary: opp?.summary || '',
        agency_or_publisher: opp?.agency_or_publisher || '',
        venue_name: opp?.venue_name || '',
        primary_source_name: src?.sources?.name || opp?.agency_or_publisher || 'Primary Source',
        primary_source_url: src?.source_url || (opp?.doi ? `https://doi.org/${opp.doi}` : ''),
        next_deadline: dls.length > 0 ? { deadline_date: dls[0].deadline_date, confidence: dls[0].confidence } : null,
        status: row.status,
        saved: true,
        notes: row.notes || '',
        saved_at: row.updated_at
      };
    });

    return createSuccessResponse({ data: formatted, total: formatted.length }, req);
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated || !auth.user?.id) {
      return auth.errorResponse!;
    }

    const noAccount = requireUserAccount(auth.user, req);
    if (noAccount) {
      return noAccount;
    }

    const ip = getClientIp(req);
    const rateCheck = await consumeRateLimit(`save_${ip}`, 30, 60000);
    if (!rateCheck.allowed) {
      return createErrorResponse('RATE_LIMIT_EXCEEDED', 'Too many requests.', 429, req);
    }

    const body = await req.json();
    const parsed = saveSchema.safeParse(body);
    if (!parsed.success) {
      return createErrorResponse('VALIDATION_ERROR', 'Invalid payload', 400, req, parsed.error.issues);
    }

    const { opportunity_id, saved, notes } = parsed.data;

    const supabase = getRequestSupabase(auth.user);

    // Upsert into user_opportunity_state
    const upsertPayload: any = {
      user_id: auth.user.id,
      opportunity_id,
      saved,
      updated_at: new Date().toISOString()
    };
    if (notes !== undefined) {
      upsertPayload.notes = notes;
    }

    const { error } = await supabase
      .from('user_opportunity_state')
      .upsert(upsertPayload, { onConflict: 'user_id,opportunity_id' });

    if (error) {
      return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
    }

    // Audit in user_activity
    {
      const { error: activityErr } = await supabase.from('user_activity').insert({
        user_id: auth.user.id,
        event_type: saved ? 'saved_opportunity' : 'unsaved_opportunity',
        title: saved ? 'Saved Opportunity' : 'Unsaved Opportunity',
        description: `Opportunity ${opportunity_id} marked as ${saved ? 'saved' : 'unsaved'}.`,
        metadata: { opportunity_id }
      });
      if (activityErr) {
        console.error('user_activity insert failed:', activityErr.message);
      }
    }

    return createSuccessResponse({ success: true, opportunity_id, saved }, req);
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
