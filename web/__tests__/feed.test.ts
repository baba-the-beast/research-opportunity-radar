import { describe, expect, it } from 'vitest';
import { isActionable, type FeedItem } from '../lib/feed';

const open: FeedItem = { kind: 'funding', is_expired: false, lifecycle_status: 'open', next_deadline: { days_left: 12 } };

describe('isActionable', () => {
  it('keeps open calls, calls opening soon and calls open all year', () => {
    expect(isActionable(open)).toBe(true);
    expect(isActionable({ ...open, lifecycle_status: 'forecasted' })).toBe(true);
    expect(isActionable({ ...open, next_deadline: null })).toBe(true); // rolling: open, no deadline
  });

  it('hides closed calls, past awards, undated notices and calls the user is ruled out of', () => {
    expect(isActionable({ ...open, is_expired: true })).toBe(false);
    expect(isActionable({ ...open, kind: 'award' })).toBe(false);
    expect(isActionable({ ...open, lifecycle_status: 'unknown', next_deadline: null })).toBe(false);
    expect(isActionable({ ...open, eligibility: { status: 'DISQUALIFIED' } })).toBe(false);
    expect(isActionable({ ...open, eligibility: { status: 'NEEDS_MANUAL_REVIEW' } })).toBe(true);
  });

  it('keeps journal papers, which never have a deadline', () => {
    expect(isActionable({ ...open, kind: 'journal', lifecycle_status: 'unknown', next_deadline: null })).toBe(true);
  });
});
