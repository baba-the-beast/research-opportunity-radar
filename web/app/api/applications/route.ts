import { NextRequest } from 'next/server';
import { getRequestSupabase, hasUserAccount } from '@/lib/routeContext';
import { authenticateRequest } from '@/lib/auth';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';
import { APPLICATION_STATUSES } from '@/lib/applications';
import { daysUntil, istDate } from '@/lib/dates';

/** The signed-in user's tracked applications (preparing, submitted, funded, not funded). */
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated) {
      return auth.errorResponse!;
    }
    // Operator and local-dev identities have no per-user rows
    if (!hasUserAccount(auth.user)) {
      return createSuccessResponse({ data: [] }, req);
    }

    const supabase = getRequestSupabase(auth.user);
    const { data, error } = await supabase
      .from('user_opportunity_state')
      .select(
        `*,
         opportunities!inner (id, kind, title, agency_or_publisher, venue_name, status,
           opportunity_deadlines (deadline_date, deadline_type, confidence),
           opportunity_sources (source_url))`
      )
      .eq('user_id', auth.user!.id)
      .in('status', [...APPLICATION_STATUSES])
      .order('updated_at', { ascending: false })
      .limit(200);
    if (error) {
      return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
    }

    const today = istDate();
    const rows = (data || []).map((row: any) => {
      const opp = Array.isArray(row.opportunities) ? row.opportunities[0] : row.opportunities;
      const next = (opp?.opportunity_deadlines || [])
        .filter((d: any) => d.deadline_date && d.deadline_date >= today)
        .sort((a: any, b: any) => a.deadline_date.localeCompare(b.deadline_date))[0];
      return {
        id: opp?.id,
        title: opp?.title,
        kind: opp?.kind,
        publisher: opp?.agency_or_publisher || opp?.venue_name || '',
        official_url: opp?.opportunity_sources?.[0]?.source_url || null,
        status: row.status,
        notes: row.notes || '',
        my_deadline: row.my_deadline ?? null,
        my_deadline_label: row.my_deadline_label ?? '',
        updated_at: row.updated_at,
        next_deadline: next
          ? { date: next.deadline_date, type: next.deadline_type, confidence: next.confidence, days_left: daysUntil(next.deadline_date, today) }
          : null
      };
    });

    return createSuccessResponse({ data: rows }, req);
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
