import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { getRequestSupabase } from '@/lib/routeContext';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';

export const dynamic = 'force-dynamic';

/** Pilot metrics for the last `days` days (default 60). Admins, operators and research offices only. */
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated || !auth.user) return auth.errorResponse!;
    if (!['admin', 'operator', 'research_office'].includes(auth.user.role)) {
      return createErrorResponse('FORBIDDEN', 'Pilot results are for research offices and operators.', 403, req);
    }
    const days = Math.min(365, Math.max(7, Number(new URL(req.url).searchParams.get('days')) || 60));
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const { data, error } = await getRequestSupabase(auth.user).rpc('pilot_metrics', { since });
    if (error) {
      if (/pilot_metrics/.test(error.message) && /function|schema cache/i.test(error.message)) {
        return createErrorResponse('NOT_AVAILABLE_YET', 'Pilot results need a database update that has not been applied yet.', 409, req);
      }
      return createErrorResponse('DATABASE_ERROR', error.message, 400, req);
    }
    return createSuccessResponse({ days, ...(data as object) }, req);
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
