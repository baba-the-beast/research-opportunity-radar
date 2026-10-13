/** Which feed items are worth acting on now. Shared by the feed and its tests. */
export interface FeedItem {
  kind: string;
  is_expired?: boolean;
  lifecycle_status?: string; // open, forecasted, closed, unknown (no deadline published)
  next_deadline: { days_left: number } | null;
  eligibility?: { status: string } | null;
}

/**
 * Open (or opening soon, or open all year) and not ruled out by the eligibility check. Hidden by
 * default: closed calls, past awards, calls with no published deadline, and calls the user is not
 * eligible for. All of them stay one click away.
 */
export function isActionable(item: FeedItem): boolean {
  if (item.kind === 'award' || item.is_expired || item.lifecycle_status === 'closed') return false;
  if (item.lifecycle_status === 'unknown' && !item.next_deadline) return false;
  if (item.eligibility?.status === 'DISQUALIFIED') return false;
  return true;
}
