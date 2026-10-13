'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { safeExternalUrl } from '@/lib/safeUrl';
import { formatDeadline } from '@/lib/dates';
import { Badge, Button, EmptyState, Icon, LoadingRows, Notice, Page, PageHeader, Panel, SegmentedControl, buttonClass } from '@/components/ui';

interface DeadlineItem {
  id: string;
  opportunity_id: string;
  title: string;
  kind: string;
  agency: string;
  deadline_type: string;
  deadline_date: string;
  days_left: number;
  confidence: string;
  source_url: string | null;
}

const KIND_LABEL: Record<string, string> = {
  funding: 'Funding call',
  venue: 'Conference',
  journal: 'Journal'
};

function monthLabel(date: string): string {
  const [y, m] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

function dayParts(date: string): { day: string; weekday: string } {
  const [y, m, d] = date.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  return {
    day: String(d),
    weekday: new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' }).format(at)
  };
}

export default function DeadlinesPage() {
  const [items, setItems] = useState<DeadlineItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (cursor: string | null, mine: boolean) => {
    const params = new URLSearchParams({ limit: '50' });
    if (cursor) params.set('cursor', cursor);
    if (mine) params.set('mine', 'true');
    const res = await fetch(`/api/deadlines?${params}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
    const rows: DeadlineItem[] = Array.isArray(body?.data) ? body.data : [];
    setNextCursor(body?.pagination?.next_cursor ?? null);
    setItems((prev) => (cursor ? [...prev, ...rows] : rows));
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    load(null, mineOnly)
      .catch((err) => setError(`Deadlines did not load (${err.message}). Refresh the page to try again.`))
      .finally(() => setLoading(false));
  }, [mineOnly]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      await load(nextCursor, mineOnly);
    } catch (err: any) {
      setError(`More deadlines did not load (${err.message}). Try again.`);
    } finally {
      setLoadingMore(false);
    }
  };

  const months = Array.from(new Set(items.map((i) => monthLabel(i.deadline_date))));
  const withinWeek = items.filter((i) => i.days_left <= 7).length;
  const icsHref = `/api/deadlines?format=ics${mineOnly ? '&mine=true' : ''}`;

  return (
    <Page narrow>
      <PageHeader
        title="Deadlines"
        description={
          loading
            ? 'Upcoming submission dates, India time (IST).'
            : items.length === 0
              ? 'Upcoming submission dates, India time (IST).'
              : `${items.length} upcoming${withinWeek > 0 ? `, ${withinWeek} in the next 7 days` : ''}. Dates are India time (IST).`
        }
        actions={
          <a href={icsHref} className={buttonClass('secondary')}>
            <Icon name="calendar_add_on" />
            Add to calendar
          </a>
        }
      />

      <SegmentedControl
        label="Which deadlines"
        value={mineOnly ? 'mine' : 'all'}
        onChange={(v) => setMineOnly(v === 'mine')}
        options={[
          { value: 'all', label: 'All open calls' },
          { value: 'mine', label: 'Saved and applying' }
        ]}
      />

      {error && <Notice tone="danger">{error}</Notice>}

      {loading ? (
        <Panel>
          <LoadingRows rows={4} label="Loading deadlines" />
        </Panel>
      ) : items.length === 0 && !error ? (
        <Panel>
          {mineOnly ? (
            <EmptyState
              icon="bookmark"
              title="No tracked deadlines"
              action={
                <Link href="/" className={buttonClass('primary')}>
                  Go to your feed
                </Link>
              }
            >
              Save a call or mark it as applying, and its deadlines appear here.
            </EmptyState>
          ) : (
            <EmptyState icon="event_available" title="No upcoming deadlines">
              Deadlines appear after the next scan (Monday and Thursday mornings, IST).
            </EmptyState>
          )}
        </Panel>
      ) : (
        <div className="flex flex-col gap-8">
          {months.map((month) => (
            <section key={month} className="flex flex-col gap-3" aria-labelledby={`m-${month}`}>
              <h2 id={`m-${month}`} className="font-headline-sm text-headline-sm text-on-surface">
                {month}
              </h2>
              <ol className="rounded-2xl surface-card bg-surface divide-y divide-outline-variant overflow-hidden">
                {items
                  .filter((i) => monthLabel(i.deadline_date) === month)
                  .map((item) => {
                    const urgent = item.days_left <= 7;
                    const { day, weekday } = dayParts(item.deadline_date);
                    const href = safeExternalUrl(item.source_url);
                    return (
                      <li key={item.id} className="flex gap-4 sm:gap-5 px-4 sm:px-5 py-4 hover:bg-surface-container-low transition-colors">
                        <div className={`w-12 shrink-0 flex flex-col items-center rounded-xl py-1.5 ${urgent ? 'bg-error-container text-on-error-container' : 'bg-surface-container text-on-surface'}`}>
                          <span className="text-[11px] leading-4">{weekday}</span>
                          <span className="text-[20px] leading-6 font-semibold tabular-nums">{day}</span>
                        </div>
                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
                            <span className={urgent ? 'text-error font-semibold' : 'text-on-surface-variant'}>
                              {item.days_left === 0 ? 'Due today' : item.days_left === 1 ? 'Due tomorrow' : `${item.days_left} days left`}
                            </span>
                            <span className="text-on-surface-variant">{KIND_LABEL[item.kind] || item.kind}</span>
                            {item.confidence !== 'confirmed' && <Badge tone="warning">Date to confirm</Badge>}
                          </div>
                          <Link href={`/opportunities/${item.opportunity_id}`} className="text-body-md font-semibold text-on-surface hover:text-primary leading-snug">
                            {item.title}
                          </Link>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-on-surface-variant">
                            <span>{item.agency}</span>
                            <span>{item.deadline_type.charAt(0).toUpperCase() + item.deadline_type.slice(1).replace(/_/g, ' ')}</span>
                            <span className="sr-only">{formatDeadline(item.deadline_date)}</span>
                            {href && (
                              <a href={href} target="_blank" rel="noreferrer" className="text-primary hover:underline underline-offset-4">
                                Official call page
                              </a>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
              </ol>
            </section>
          ))}

          {nextCursor && (
            <Button onClick={loadMore} disabled={loadingMore} className="self-center">
              {loadingMore ? 'Loading…' : 'Show more deadlines'}
            </Button>
          )}
        </div>
      )}
    </Page>
  );
}
