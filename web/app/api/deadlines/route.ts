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
    const cursor = searchParams.get('cursor'); // ISO date string

    const supabase = getSupabaseUserClient(auth.user?.token);
    let query = supabase
      .from('opportunity_deadlines')
      .select('*, opportunities(id, title, kind, opportunity_sources(source_url))')
      .order('deadline_date', { ascending: true })
      .limit(limit + 1);

    if (cursor) {
      query = query.gt('deadline_date', cursor);
    }

    const { data: dls, error } = await query;

    if (error) {
      return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
    }

    const rows = dls || [];
    const hasMore = rows.length > limit;
    const paginatedRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && paginatedRows.length > 0 ? paginatedRows[paginatedRows.length - 1].deadline_date : null;

    const formatted = paginatedRows.map((row: any) => ({
      id: row.id,
      opportunity_id: row.opportunities?.id,
      title: row.opportunities?.title || 'Untitled',
      deadline_type: row.deadline_type,
      deadline_date: row.deadline_date,
      confidence: row.confidence,
      source_url: row.opportunities?.opportunity_sources?.[0]?.source_url || '#'
    }));

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
