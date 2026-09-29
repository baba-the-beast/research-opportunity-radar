import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { getRequestSupabase } from '@/lib/routeContext';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';

export const dynamic = 'force-dynamic';

/**
 * Latest pipeline run, for the dashboard's "last scan" line and for polling after a rescan is
 * dispatched to GitHub Actions. Error texts stay in run_log for operators; users get a count.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated) {
      return auth.errorResponse!;
    }

    const supabase = getRequestSupabase(auth.user);
    const { data, error } = await supabase
      .from('run_log')
      .select('id, status, started_at, finished_at, opportunities_found, opportunities_new, errors')
      .order('started_at', { ascending: false })
      .limit(1);
    if (error) {
      return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
    }

    const run = data?.[0];
    return createSuccessResponse(
      run
        ? {
            id: run.id,
            status: run.status,
            started_at: run.started_at,
            finished_at: run.finished_at,
            opportunities_found: run.opportunities_found ?? 0,
            opportunities_new: run.opportunities_new ?? 0,
            error_count: Array.isArray(run.errors) ? run.errors.length : 0
          }
        : null,
      req
    );
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
