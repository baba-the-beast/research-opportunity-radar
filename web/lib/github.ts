/**
 * Starts a GitHub Actions workflow (scans and rescoring run there, next to the Python pipeline).
 * Needs GITHUB_PAT (Actions: write) and GITHUB_REPO (owner/repo) on the web server.
 */

export type DispatchResult = { ok: true; repo: string } | { ok: false; status: number; code: string; message: string };

export function githubRepo(): string | null {
  return (
    process.env.GITHUB_REPO ||
    (process.env.GITHUB_REPO_OWNER && process.env.GITHUB_REPO_NAME ? `${process.env.GITHUB_REPO_OWNER}/${process.env.GITHUB_REPO_NAME}` : null)
  );
}

export async function dispatchWorkflow(workflowFile: string, inputs?: Record<string, string>): Promise<DispatchResult> {
  const token = process.env.GITHUB_PAT;
  if (!token) {
    return { ok: false, status: 501, code: 'NOT_CONFIGURED', message: 'GITHUB_PAT is not configured. A token with Actions: write on the repository is required.' };
  }
  const repo = githubRepo();
  if (!repo) {
    return { ok: false, status: 501, code: 'NOT_CONFIGURED', message: 'GITHUB_REPO is not configured. Set it in owner/repo format.' };
  }
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/dispatches`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    // Branch whose workflow runs; override with GITHUB_REF for a staging branch
    body: JSON.stringify({ ref: process.env.GITHUB_REF || 'main', ...(inputs ? { inputs } : {}) })
  });
  if (res.ok) return { ok: true, repo };
  const text = await res.text();
  // GitHub's 401/404 describe our token/repo config, not the caller's request: report a 502
  const hint =
    res.status === 401 || res.status === 403
      ? 'check that GITHUB_PAT is valid and has Actions: write on the repository'
      : res.status === 404
        ? `check GITHUB_REPO (owner/repo) and that .github/workflows/${workflowFile} exists on the branch`
        : text.slice(0, 200);
  return { ok: false, status: 502, code: 'GITHUB_API_ERROR', message: `GitHub ${res.status}: ${hint}` };
}
