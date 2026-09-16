import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseUserClient, getSupabaseAdminClient } from '@/lib/supabaseServerClient';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated) {
      return auth.errorResponse!;
    }

    const roleCheck = authorizeRole(auth.user, ['faculty', 'operator', 'admin']);
    if (!roleCheck.authorized) {
      return roleCheck.errorResponse!;
    }

    const searchParams = req.nextUrl.searchParams;
    const limitParam = parseInt(searchParams.get('limit') || '20', 10);
    const limit = Math.max(1, Math.min(isNaN(limitParam) ? 20 : limitParam, 50));
    const cursor = searchParams.get('cursor'); // ISO timestamp for started_at

    const supabase = auth.user?.isServiceRole
      ? getSupabaseAdminClient()
      : getSupabaseUserClient(auth.user?.token);

    let query = supabase
      .from('run_log')
      .select('*, source_runs(*, sources(name))')
      .order('started_at', { ascending: false })
      .limit(limit + 1);

    if (cursor) {
      query = query.lt('started_at', cursor);
    }

    const { data: runs, error } = await query;

    if (error) {
      return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
    }

    const rows = runs || [];
    const hasMore = rows.length > limit;
    const paginatedRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && paginatedRows.length > 0 ? paginatedRows[paginatedRows.length - 1].started_at : null;

    const formatted = paginatedRows.map((r: any) => ({
      run_id: r.id,
      started_at: r.started_at,
      finished_at: r.finished_at,
      status: r.status,
      opportunities_found: r.opportunities_found,
      opportunities_new: r.opportunities_new,
      errors: r.errors || [],
      sources: (r.source_runs || []).map((sr: any) => ({
        source_name: sr.sources?.name || 'Unknown Source',
        status: sr.status,
        request_count: sr.request_count,
        inserted_count: sr.inserted_count,
        error_category: sr.error_category,
        latency_ms: sr.latency_ms
      }))
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
