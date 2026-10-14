import { NextRequest } from 'next/server';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { consumeRateLimit } from '@/lib/rateLimit';
import { requireUserAccount } from '@/lib/routeContext';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';
import { dispatchWorkflow } from '@/lib/github';

/**
 * Asks for the caller's matches to be recalculated now (rescore.yml), instead of on the next
 * scheduled scan. Called by the profile page after a save. 501 when GitHub dispatch is not set up:
 * the scores then update on the next scan as before.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated || !auth.user?.id) return auth.errorResponse!;
    const noAccount = requireUserAccount(auth.user, req);
    if (noAccount) return noAccount;
    const roleCheck = authorizeRole(auth.user, ['faculty', 'operator', 'admin']);
    if (!roleCheck.authorized) return roleCheck.errorResponse!;

    // A rescore takes a few minutes and picks up every later save, so a handful per hour is plenty
    const rate = await consumeRateLimit(`rescore_${auth.user.id}`, 6, 60 * 60 * 1000);
    if (!rate.allowed) {
      return createErrorResponse('RATE_LIMIT_EXCEEDED', 'Your matches are already being recalculated.', 429, req);
    }
    const dispatched = await dispatchWorkflow('rescore.yml', { user_id: auth.user.id });
    if (!dispatched.ok) return createErrorResponse(dispatched.code, dispatched.message, dispatched.status, req);
    return createSuccessResponse({ requested: true }, req, 202);
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
