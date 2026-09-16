import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { acquirePipelineLock } from '@/lib/pipelineLock';
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
    const rateCheck = checkRateLimit(`trigger_${ip}`, 5, 600000);
    if (!rateCheck.allowed) {
      return createErrorResponse(
        'RATE_LIMIT_EXCEEDED',
        'Rate limit exceeded: Too many pipeline trigger requests.',
        429,
        req
      );
    }

    // 3. Concurrency check
    const lockResult = await acquirePipelineLock('pipeline_main', 'github_actions_dispatcher', 900);
    if (!lockResult.acquired) {
      return createErrorResponse(
        'PIPELINE_CONCURRENCY_CONFLICT',
        `Pipeline execution already active by '${lockResult.currentHolder || 'unknown'}'. Dispatch rejected.`,
        409,
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
