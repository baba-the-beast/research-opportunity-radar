import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/apiAuth';
import { checkRateLimit } from '@/lib/rateLimit';

export async function POST(req: Request) {
  try {
    // 1. Authentication check
    const auth = validateApiAuth(req);
    if (!auth.authorized && auth.response) {
      return auth.response;
    }

    // 2. Rate limiting check (max 5 triggers per 10 minutes)
    const ip = req.headers.get('x-forwarded-for') || 'local-client';
    const rateCheck = checkRateLimit(`trigger_${ip}`, 5, 600000);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded: Too many pipeline trigger requests.',
          retryAfterSeconds: rateCheck.retryAfterSeconds
        },
        {
          status: 429,
          headers: { 'Retry-After': String(rateCheck.retryAfterSeconds) }
        }
      );
    }

    const ghToken = process.env.GITHUB_PAT;
    if (!ghToken) {
      return NextResponse.json(
        { error: 'GITHUB_PAT environment variable not configured. A GitHub personal access token with repo/actions permissions is required.' },
        { status: 501 }
      );
    }

    const ghRepo = process.env.GITHUB_REPO || (process.env.GITHUB_REPO_OWNER && process.env.GITHUB_REPO_NAME ? `${process.env.GITHUB_REPO_OWNER}/${process.env.GITHUB_REPO_NAME}` : null);
    if (!ghRepo) {
      return NextResponse.json(
        { error: 'GITHUB_REPO environment variable not configured. Please set GITHUB_REPO in owner/repo format (e.g. your-org/research-opportunity-radar).' },
        { status: 501 }
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
      return NextResponse.json({ error: `GitHub API call failed (${res.status}): ${errText}` }, { status: res.status });
    }

    return NextResponse.json({ message: `Pipeline trigger requested for ${ghRepo}` }, { status: 202 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
