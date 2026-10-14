import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { consumeRateLimit, rateLimitKey } from '@/lib/rateLimit';
import { getActivePipelineLock } from '@/lib/pipelineLock';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';
import { dispatchWorkflow } from '@/lib/github';

export async function POST(req: NextRequest) {
  try {
    // 1. Authentication & Authorization
    const auth = await authenticateRequest(req);
    if (!auth.authenticated) {
      return auth.errorResponse!;
    }
    const roleCheck = authorizeRole(auth.user, ['operator', 'admin']);
    if (!roleCheck.authorized) {
      return roleCheck.errorResponse!;
    }

    // 2. Sanitized Rate limiting check (max 5 triggers per 10 minutes)
    const ip = rateLimitKey(req, auth.user);
    const rateCheck = await consumeRateLimit(`trigger_${ip}`, 5, 600000);
    if (!rateCheck.allowed) {
      return createErrorResponse(
        'RATE_LIMIT_EXCEEDED',
        'Rate limit exceeded: Too many pipeline trigger requests.',
        429,
        req
      );
    }

    // Fail fast if a run is in progress. The dispatched workflow's Python process takes the
    // actual lease itself, so no lock is held (or leaked) here.
    let active;
    try {
      active = await getActivePipelineLock();
    } catch (err: any) {
      return createErrorResponse('DATABASE_ERROR', `Could not check pipeline status: ${err.message}`, 503, req);
    }
    if (active) {
      return createErrorResponse(
        'PIPELINE_CONCURRENCY_CONFLICT',
        `Pipeline execution already active by '${active.lockedBy}' until ${active.expiresAt}. Dispatch rejected.`,
        409,
        req
      );
    }

    const dispatched = await dispatchWorkflow('pipeline.yml');
    if (!dispatched.ok) {
      const message = dispatched.code === 'GITHUB_API_ERROR' ? `Could not start the scan (${dispatched.message})` : dispatched.message;
      return createErrorResponse(dispatched.code, message, dispatched.status, req);
    }

    return createSuccessResponse({ message: `Pipeline trigger successfully dispatched for ${dispatched.repo}` }, req, 202);
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
