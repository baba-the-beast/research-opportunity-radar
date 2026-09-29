import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';
import { getOwnProfileId, getRequestSupabase, UUID_PATTERN } from '@/lib/routeContext';
import { daysUntil, istDate } from '@/lib/dates';

export const dynamic = 'force-dynamic';

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Keyset cursor "<discovered_at>|<id>". The id tiebreak keeps pages stable when several
 * opportunities share a discovered_at (batch inserts). A bare timestamp is accepted for old clients.
 */
function parseCursor(raw: string | null): { ts: string; id?: string } | null | 'invalid' {
  if (!raw) return null;
  const [ts, id] = raw.split('|');
  if (!ISO_TIMESTAMP.test(ts) || (id !== undefined && !UUID_PATTERN.test(id))) return 'invalid';
  return { ts, id };
}

/** The next deadline on or after today (IST); if all have passed, the last one (so the UI can say "closed on"). */
function nextDeadline(deadlines: any[], today: string): { deadline: any | null; expired: boolean } {
  const dated = deadlines.filter((d) => d.deadline_date);
  const sorted = [...dated].sort((a, b) => String(a.deadline_date).localeCompare(String(b.deadline_date)));
  const upcoming = sorted.find((d) => d.deadline_date >= today);
  if (upcoming) return { deadline: upcoming, expired: false };
  return { deadline: sorted[sorted.length - 1] || null, expired: sorted.length > 0 };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated) {
      return auth.errorResponse!;
    }

    const searchParams = req.nextUrl.searchParams;
    const limitParam = parseInt(searchParams.get('limit') || '20', 10);
    const limit = Math.max(1, Math.min(isNaN(limitParam) ? 20 : limitParam, 50));
    const cursor = parseCursor(searchParams.get('cursor'));
    if (cursor === 'invalid') {
      return createErrorResponse('VALIDATION_ERROR', 'Invalid pagination cursor', 400, req);
    }
    const kindFilter = searchParams.get('kind');
    const savedOnly = searchParams.get('saved') === 'true';
    const statusFilter = searchParams.get('status');
    // Closed calls (every deadline passed) are hidden unless asked for
    const includeClosed = searchParams.get('include_closed') === 'true';
    const search = (searchParams.get('q') || '').trim().slice(0, 100);
    const hasStatusFilter = Boolean(statusFilter && statusFilter !== 'all');

    const supabase = getRequestSupabase(auth.user);
    const userId = auth.user?.isServiceRole ? null : auth.user?.id;
    const profileId = await getOwnProfileId(supabase, auth.user);

    // Saved/status filters join the caller's user_opportunity_state rows inside the same query, so
    // pagination stays correct and the URL doesn't grow with the user's history (an id list in
    // ?id=in.(...) eventually breaks proxy URL limits).
    //  - 'inner': saved and/or a specific tracked status -> only opportunities with a matching row
    //  - 'anti':  status=new -> opportunities with NO non-'new' row (no row at all means 'new')
    const stateJoin: 'none' | 'inner' | 'anti' =
      !savedOnly && !hasStatusFilter ? 'none' : !savedOnly && statusFilter === 'new' ? 'anti' : 'inner';
    if (stateJoin !== 'none' && !userId) {
      return createSuccessResponse({ data: [], pagination: { limit, next_cursor: null, has_more: false } }, req);
    }
    const stateSelect =
      stateJoin === 'inner'
        ? ',user_opportunity_state!inner (status)'
        : stateJoin === 'anti'
          ? ',user_opportunity_state!left (status)'
          : '';

    // Scores are per faculty: embed only this user's latest scoring_log row
    const scoringSelect = profileId ? ',scoring_log (final_score, band, components, matched_terms, scored_at)' : '';
    let query = supabase
      .from('opportunities')
      .select(`
        id, kind, title, summary, agency_or_publisher, venue_name, doi, status, discovered_at, fingerprint,
        opportunity_deadlines (id, deadline_type, deadline_date, confidence, raw_text),
        opportunity_sources (source_url, source_id, sources (name))${scoringSelect}${stateSelect}
      `)
      .order('discovered_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (profileId) {
      query = query
        .eq('scoring_log.faculty_id', profileId)
        .order('scored_at', { referencedTable: 'scoring_log', ascending: false })
        .limit(1, { referencedTable: 'scoring_log' });
    }

    if (cursor) {
      query = cursor.id
        ? query.or(`discovered_at.lt."${cursor.ts}",and(discovered_at.eq."${cursor.ts}",id.lt.${cursor.id})`)
        : query.lt('discovered_at', cursor.ts);
    }

    if (kindFilter && kindFilter !== 'all') {
      query = query.eq('kind', kindFilter);
    }
    if (!includeClosed) {
      query = query.neq('status', 'closed');
    }
    if (search) {
      // PostgREST ilike pattern; strip characters that have meaning in the filter syntax
      const safe = search.replace(/[%_,()*\\]/g, ' ');
      query = query.or(`title.ilike.%${safe}%,summary.ilike.%${safe}%,agency_or_publisher.ilike.%${safe}%`);
    }

    if (stateJoin === 'inner') {
      query = query.eq('user_opportunity_state.user_id', userId!);
      if (savedOnly) query = query.eq('user_opportunity_state.saved', true);
      if (hasStatusFilter) query = query.eq('user_opportunity_state.status', statusFilter!);
    } else if (stateJoin === 'anti') {
      query = query
        .eq('user_opportunity_state.user_id', userId!)
        .neq('user_opportunity_state.status', 'new')
        .is('user_opportunity_state', null);
    }

    const { data: opps, error } = await query;
    if (error) {
      return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
    }

    // any[]: the conditional scoring_log embed makes the select string non-literal for the type parser
    const rows: any[] = opps || [];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    // User-scoped state (saved, notes, personal status) for this page
    const userStatesMap: Record<string, { saved: boolean; status: string; notes?: string; personal_score?: number }> = {};
    if (userId && pageRows.length > 0) {
      const { data: userStates, error: usErr } = await supabase
        .from('user_opportunity_state')
        .select('opportunity_id, status, saved, notes, personal_score')
        .eq('user_id', userId)
        .in('opportunity_id', pageRows.map((r: any) => r.id));
      if (usErr) {
        return createErrorResponse('DATABASE_ERROR', usErr.message, 500, req);
      }
      for (const st of userStates || []) {
        userStatesMap[st.opportunity_id] = st;
      }
    }

    const today = istDate();
    const formatted = pageRows.map((row: any) => {
      const src = row.opportunity_sources?.[0];
      const scoring = row.scoring_log?.[0];
      const { deadline: nextDl, expired } = nextDeadline(row.opportunity_deadlines || [], today);
      const userState = userStatesMap[row.id];
      const personalScore = userState?.personal_score ?? scoring?.final_score ?? null;

      return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        summary: row.summary,
        agency_or_publisher: row.agency_or_publisher,
        venue_name: row.venue_name,
        primary_source_name: src?.sources?.name || row.agency_or_publisher || 'Primary Source',
        primary_source_url: src?.source_url || (row.doi ? `https://doi.org/${row.doi}` : ''),
        next_deadline: nextDl
          ? { deadline_date: nextDl.deadline_date, confidence: nextDl.confidence, days_left: daysUntil(nextDl.deadline_date, today) }
          : null,
        // Lifecycle of the call itself (open / forecasted / closed / unknown = no published deadline)
        lifecycle_status: expired ? 'closed' : row.status,
        is_expired: expired || row.status === 'closed',
        // null = not yet scored for this user (new profile awaiting the next pipeline run)
        final_score: personalScore === null ? null : Number(personalScore),
        band: scoring?.band ?? 'unscored',
        matched_terms: scoring?.matched_terms || [],
        status: userState?.status || 'new',
        saved: Boolean(userState?.saved),
        notes: userState?.notes || ''
      };
    });

    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last ? `${last.discovered_at}|${last.id}` : null;

    // Check if client requested legacy array format
    if (searchParams.get('format') === 'array') {
      return NextResponse.json(formatted);
    }

    return createSuccessResponse(
      {
        data: formatted,
        pagination: {
          limit,
          next_cursor: nextCursor,
          has_more: hasMore
        }
      },
      req
    );
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
