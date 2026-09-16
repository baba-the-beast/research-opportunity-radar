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

    const { data: opps, error } = await query;

    if (error) {
      return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
    }

    const rows = opps || [];
    const hasMore = rows.length > limit;
    const paginatedRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && paginatedRows.length > 0 ? paginatedRows[paginatedRows.length - 1].discovered_at : null;

    const formatted = paginatedRows.map((row: any) => {
      const src = row.opportunity_sources?.[0];
      const scoring = row.scoring_log?.[0] || { final_score: 50, band: 'watch', matched_terms: [] };
      const dls = row.opportunity_deadlines || [];
      const nextDl = dls.length > 0 ? dls[0] : null;

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
        final_score: scoring.final_score,
        band: scoring.band,
        matched_terms: scoring.matched_terms || [],
        status: row.opportunity_status?.[0]?.status || 'new'
      };
    });

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
