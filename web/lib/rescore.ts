/**
 * After a profile save the dashboard asks for the user's matches to be recalculated (a few minutes
 * on GitHub Actions). This per-browser note lets the feed say so instead of showing bare "Not scored".
 */
const KEY = 'radar.rescoreRequestedAt';
const SHOW_FOR_MS = 20 * 60 * 1000;

export async function requestRescore(): Promise<'started' | 'later'> {
  try {
    const res = await fetch('/api/profile/rescore', { method: 'POST' });
    if (res.ok || res.status === 429) {
      try {
        localStorage.setItem(KEY, String(Date.now()));
      } catch {
        // storage blocked: the feed just won't show the "matching now" note
      }
      return 'started';
    }
  } catch {
    // offline or not configured: scores update on the next scheduled scan
  }
  return 'later';
}

/** True for a while after a rescore was requested from this browser. */
export function rescorePending(now: number = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(KEY));
    return Number.isFinite(at) && at > 0 && now - at < SHOW_FOR_MS;
  } catch {
    return false;
  }
}
