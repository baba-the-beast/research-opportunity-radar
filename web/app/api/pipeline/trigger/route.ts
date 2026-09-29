import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { consumeRateLimit, getClientIp } from '@/lib/rateLimit';
import { getActivePipelineLock } from '@/lib/pipelineLock';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';

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
    const ip = getClientIp(req);
    const rateCheck = await consumeRateLimit(`trigger_${ip}`, 5, 600000);
    if (!rateCheck.allowed) {
      return createErrorResponse(
        'RATE_LIMIT_EXCEEDED',
        'Rate limit exceeded: Too many pipeline trigger requests.',
        429,
        req
      );
    }

    const ghToken = process.env.GITHUB_PAT;
    if (!ghToken) {
      return createErrorResponse(
        'NOT_CONFIGURED',
        'GITHUB_PAT environment variable not configured. A GitHub personal access token with repo/actions permissions is required.',
        501,
        req
      );
    }

    const ghRepo = process.env.GITHUB_REPO || (process.env.GITHUB_REPO_OWNER && process.env.GITHUB_REPO_NAME ? `${process.env.GITHUB_REPO_OWNER}/${process.env.GITHUB_REPO_NAME}` : null);
    if (!ghRepo) {
      return createErrorResponse(
        'NOT_CONFIGURED',
        'GITHUB_REPO environment variable not configured. Please set GITHUB_REPO in owner/repo format (e.g. your-org/research-opportunity-radar).',
        501,
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

    const res = await fetch(`https://api.github.com/repos/${ghRepo}/actions/workflows/pipeline.yml/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ghToken}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ref: 'main' })
    });

    if (!res.ok) {
      const errText = await res.text();
      return createErrorResponse('GITHUB_API_ERROR', `GitHub API call failed (${res.status}): ${errText}`, res.status, req);
    }

    return createSuccessResponse(
      { message: `Pipeline trigger successfully dispatched for ${ghRepo}` },
      req,
      202
    );
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
