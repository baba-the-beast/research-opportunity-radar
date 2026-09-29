import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { consumeRateLimit, rateLimitKey } from '@/lib/rateLimit';
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
      // Branch whose pipeline.yml runs; override with GITHUB_REF for a staging branch
      body: JSON.stringify({ ref: process.env.GITHUB_REF || 'main' })
    });

    if (!res.ok) {
      const errText = await res.text();
      // GitHub's 401/404 describe our token/repo config, not the caller's request: report a 502
      const hint =
        res.status === 401 || res.status === 403
          ? 'check that GITHUB_PAT is valid and has Actions: write on the repository'
          : res.status === 404
            ? 'check GITHUB_REPO (owner/repo) and that .github/workflows/pipeline.yml exists on the branch'
            : errText.slice(0, 200);
      return createErrorResponse('GITHUB_API_ERROR', `Could not start the scan (GitHub ${res.status}): ${hint}`, 502, req);
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
