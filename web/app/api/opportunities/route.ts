import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseUserClient } from '@/lib/supabaseServerClient';
import { authenticateRequest } from '@/lib/auth';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated) {
      return auth.errorResponse!;
    }

    const searchParams = req.nextUrl.searchParams;
    const limitParam = parseInt(searchParams.get('limit') || '20', 10);
    const limit = Math.max(1, Math.min(isNaN(limitParam) ? 20 : limitParam, 50));
    const cursor = searchParams.get('cursor'); // ISO timestamp for discovered_at pagination
    const kindFilter = searchParams.get('kind');
    const savedOnly = searchParams.get('saved') === 'true';
    const statusFilter = searchParams.get('status');

    const supabase = getSupabaseUserClient(auth.user?.token);
    let query = supabase
      .from('opportunities')
      .select(`
        id, kind, title, summary, agency_or_publisher, venue_name, doi, status, discovered_at, fingerprint,
        opportunity_deadlines (id, deadline_type, deadline_date, confidence, raw_text),
        opportunity_sources (source_url, source_id, sources (name)),
        opportunity_status (status),
        scoring_log (final_score, band, components, matched_terms)
      `)
      .order('discovered_at', { ascending: false })
      .limit(limit + 1);

    if (cursor) {
      query = query.lt('discovered_at', cursor);
    }

    if (kindFilter && kindFilter !== 'all') {
      query = query.eq('kind', kindFilter);
    }

    const { data: opps, error } = await query;

    if (error) {
      return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
    }

    const rows = opps || [];
    const oppIds = rows.map((r: any) => r.id);

    // Fetch user-scoped opportunity state (saved, notes, personal status)
    const userStatesMap: Record<string, { saved: boolean; status: string; notes?: string; personal_score?: number }> = {};
    if (auth.user?.id && oppIds.length > 0) {
      try {
        const { data: userStates } = await supabase
          .from('user_opportunity_state')
          .select('opportunity_id, status, saved, notes, personal_score')
          .eq('user_id', auth.user.id)
          .in('opportunity_id', oppIds);

        if (userStates) {
          for (const s of userStates) {
            userStatesMap[s.opportunity_id] = s;
          }
        }
      } catch {
        // Tolerant if table not yet migrated
      }
    }

    // Format and apply user-specific filters (e.g. saved-only)
    let formatted = rows.map((row: any) => {
      const src = row.opportunity_sources?.[0];
      const scoring = row.scoring_log?.[0] || { final_score: 50, band: 'watch', matched_terms: [] };
      const dls = row.opportunity_deadlines || [];
      const nextDl = dls.length > 0 ? dls[0] : null;
      const userState = userStatesMap[row.id];

      const saved = Boolean(userState?.saved);
      const status = userState?.status || row.opportunity_status?.[0]?.status || 'new';
      const personalScore = userState?.personal_score !== undefined && userState?.personal_score !== null
        ? Number(userState.personal_score)
        : Number(scoring.final_score);

      return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        summary: row.summary,
        agency_or_publisher: row.agency_or_publisher,
        venue_name: row.venue_name,
        primary_source_name: src?.sources?.name || row.agency_or_publisher || 'Primary Source',
        primary_source_url: src?.source_url || (row.doi ? `https://doi.org/${row.doi}` : ''),
        next_deadline: nextDl ? { deadline_date: nextDl.deadline_date, confidence: nextDl.confidence } : null,
        final_score: personalScore,
        band: scoring.band,
        matched_terms: scoring.matched_terms || [],
        status,
        saved,
        notes: userState?.notes || ''
      };
    });

    if (savedOnly) {
      formatted = formatted.filter((item: any) => item.saved);
    }

    if (statusFilter && statusFilter !== 'all') {
      formatted = formatted.filter((item: any) => item.status === statusFilter);
    }

    const hasMore = formatted.length > limit;
    const paginatedRows = hasMore ? formatted.slice(0, limit) : formatted;
    const nextCursor = hasMore && paginatedRows.length > 0
      ? rows[paginatedRows.length - 1]?.discovered_at
      : null;

    // Check if client requested legacy array format
    if (searchParams.get('format') === 'array') {
      return NextResponse.json(paginatedRows);
    }

    return createSuccessResponse(
      {
        data: paginatedRows,
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
