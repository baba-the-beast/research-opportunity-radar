import { NextRequest, NextResponse } from 'next/server';
import { getRequestSupabase, UUID_PATTERN } from '@/lib/routeContext';
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
    // Keyset cursor "<deadline_date>|<id>": the id tiebreak keeps deadlines that share a date
    // from being skipped at a page boundary. A bare date is accepted for old clients.
    const rawCursor = searchParams.get('cursor');
    const [cursorDate, cursorId] = rawCursor ? rawCursor.split('|') : [];
    if (rawCursor && (!/^\d{4}-\d{2}-\d{2}$/.test(cursorDate) || (cursorId !== undefined && !UUID_PATTERN.test(cursorId)))) {
      return createErrorResponse('VALIDATION_ERROR', 'Invalid pagination cursor', 400, req);
    }
    const includePast = searchParams.get('include_past') === 'true';
    const today = new Date().toISOString().slice(0, 10);

    const supabase = getRequestSupabase(auth.user);
    let query = supabase
      .from('opportunity_deadlines')
      .select('*, opportunities(id, title, kind, opportunity_sources(source_url))')
      .order('deadline_date', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit + 1);

    if (!includePast) {
      query = query.gte('deadline_date', today);
    }

    if (rawCursor) {
      query = cursorId
        ? query.or(`deadline_date.gt.${cursorDate},and(deadline_date.eq.${cursorDate},id.gt.${cursorId})`)
        : query.gt('deadline_date', cursorDate);
    }

    const { data: dls, error } = await query;

    if (error) {
      return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
    }

    const rows = dls || [];
    const hasMore = rows.length > limit;
    const paginatedRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = paginatedRows[paginatedRows.length - 1];
    const nextCursor = hasMore && lastRow ? `${lastRow.deadline_date}|${lastRow.id}` : null;

    const formatted = paginatedRows.map((row: any) => ({
      id: row.id,
      opportunity_id: row.opportunities?.id,
      title: row.opportunities?.title || 'Untitled',
      deadline_type: row.deadline_type,
      deadline_date: row.deadline_date,
      timezone: row.timezone || 'Asia/Kolkata', // Explicitly return IST default per schema
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
