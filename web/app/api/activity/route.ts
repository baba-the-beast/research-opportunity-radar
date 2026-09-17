import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseUserClient, getSupabaseAdminClient } from '@/lib/supabaseServerClient';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const activityLogSchema = z.object({
  event_type: z.enum([
    'login', 'logout', 'saved_opportunity', 'unsaved_opportunity',
    'status_change', 'profile_update', 'preferences_update',
    'chat_message', 'copilot_tool_executed', 'export_calendar'
  ]),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  metadata: z.record(z.any()).optional()
});

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated) {
      return auth.errorResponse!;
    }

    const searchParams = req.nextUrl.searchParams;
    const scope = searchParams.get('scope') || 'all';
    const limitParam = parseInt(searchParams.get('limit') || '20', 10);
    const limit = Math.max(1, Math.min(isNaN(limitParam) ? 20 : limitParam, 50));
    const cursor = searchParams.get('cursor');

    const supabase = auth.user?.isServiceRole
      ? getSupabaseAdminClient()
      : getSupabaseUserClient(auth.user?.token);

    // If client requested system run telemetry
    if (scope === 'system' || searchParams.get('format') === 'array') {
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
          pagination: { limit, next_cursor: nextCursor, has_more: hasMore }
        },
        req
      );
    }

    // Default: User-scoped personal activity
    if (!auth.user?.id) {
      return createSuccessResponse({ data: [], pagination: { limit, next_cursor: null, has_more: false } }, req);
    }

    let actQuery = supabase
      .from('user_activity')
      .select('*')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(limit + 1);

    if (cursor) {
      actQuery = actQuery.lt('created_at', cursor);
    }

    const { data: activities, error: actErr } = await actQuery;
    if (actErr) {
      // If table not yet present in environment, return empty gracefully
      return createSuccessResponse({ data: [], pagination: { limit, next_cursor: null, has_more: false } }, req);
    }

    const rows = activities || [];
    const hasMore = rows.length > limit;
    const paginatedRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && paginatedRows.length > 0 ? paginatedRows[paginatedRows.length - 1].created_at : null;

    return createSuccessResponse(
      {
        data: paginatedRows,
        pagination: { limit, next_cursor: nextCursor, has_more: hasMore }
      },
      req
    );
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

    const body = await req.json();
    const parsed = activityLogSchema.safeParse(body);
    if (!parsed.success) {
      return createErrorResponse('VALIDATION_ERROR', 'Invalid activity payload', 400, req, parsed.error.issues);
    }

    const supabase = auth.user.isServiceRole
      ? getSupabaseAdminClient()
      : getSupabaseUserClient(auth.user.token);

    const { data, error } = await supabase
      .from('user_activity')
      .insert({
        user_id: auth.user.id,
        event_type: parsed.data.event_type,
        title: parsed.data.title,
        description: parsed.data.description || null,
        metadata: parsed.data.metadata || {}
      })
      .select()
      .single();

    if (error) {
      return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
    }

    return createSuccessResponse(data, req);
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
