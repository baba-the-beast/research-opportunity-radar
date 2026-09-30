'use client';

import { useEffect, useState } from 'react';
import { safeExternalUrl } from '@/lib/safeUrl';
import Link from 'next/link';
import { formatDeadline } from '@/lib/dates';

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
  funding: 'Funding',
  venue: 'Conference',
  journal: 'Journal'
};

function monthLabel(date: string): string {
  const [y, m] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export default function DeadlinesPage() {
  const [items, setItems] = useState<DeadlineItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (cursor: string | null, mine: boolean) => {
    const params = new URLSearchParams({ limit: '50' });
    if (cursor) params.set('cursor', cursor);
    if (mine) params.set('mine', 'true');
    const res = await fetch(`/api/deadlines?${params}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
    const page = body?.data;
    const rows: DeadlineItem[] = Array.isArray(page?.data) ? page.data : [];
    setNextCursor(page?.pagination?.next_cursor ?? null);
    setItems((prev) => (cursor ? [...prev, ...rows] : rows));
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    load(null, mineOnly)
      .catch((err) => setError(`Could not load deadlines: ${err.message}`))
      .finally(() => setLoading(false));
  }, [mineOnly]);

  const months = Array.from(new Set(items.map((i) => monthLabel(i.deadline_date))));
  const withinWeek = items.filter((i) => i.days_left <= 7).length;
  const probable = items.filter((i) => i.confidence !== 'confirmed').length;
  const icsHref = `/api/deadlines?format=ics${mineOnly ? '&mine=true' : ''}`;

  return (
    <div className="flex flex-col w-full">
      <div className="w-full bg-surface-container-lowest py-space-xs sm:py-space-sm px-space-md sm:px-space-xl flex flex-wrap items-center justify-between gap-space-sm sm:gap-space-md border-b border-surface-container">
        <div className="flex items-center gap-space-sm min-w-0 font-data-mono-sm text-data-mono-sm text-on-surface-variant">
          <span className="material-symbols-outlined text-[15px] text-primary shrink-0">calendar_month</span>
          <a className="text-primary underline hover:text-primary-fixed decoration-primary/40 underline-offset-2" href={icsHref}>
            Download calendar (.ics)
          </a>
          <span className="text-outline hidden sm:inline">All dates are India time (IST)</span>
        </div>
        <div className="flex items-center gap-space-md sm:gap-space-lg font-data-mono-sm text-data-mono-sm text-on-surface-variant flex-wrap">
          <span>{items.length} upcoming</span>
          <span className="text-error font-bold">{withinWeek} within 7 days</span>
          {probable > 0 && <span title="Date read from the call document rather than the agency's listing">{probable} to confirm</span>}
        </div>
      </div>

      <div className="w-full px-space-md sm:px-space-xl py-space-md sm:py-space-xl max-w-4xl">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-space-sm mb-space-lg sm:mb-space-xl border-b border-surface-container pb-space-md">
          <div>
            <span className="font-label-caps text-label-caps text-on-surface-variant tracking-widest block uppercase">Deadlines</span>
            <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight mt-space-2xs">Upcoming submission deadlines</h1>
          </div>
          <div className="flex gap-1 font-data-mono-sm text-data-mono-sm" role="tablist" aria-label="Which deadlines">
            {[
              { value: false, label: 'All open calls' },
              { value: true, label: 'Saved / pursuing' }
            ].map((opt) => (
              <button
                key={opt.label}
                type="button"
                role="tab"
                aria-selected={mineOnly === opt.value}
                onClick={() => setMineOnly(opt.value)}
                className={`px-space-sm py-space-2xs transition-colors ${
                  mineOnly === opt.value ? 'bg-primary-container text-on-primary-container font-bold' : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative pl-5 sm:pl-8 lg:pl-10">
          <div className="absolute left-1.5 sm:left-2 top-2 bottom-6 w-px bg-surface-container"></div>

          {loading ? (
            <div className="p-space-2xl text-center font-data-mono-sm text-data-mono-sm text-on-surface-variant">Loading deadlines...</div>
          ) : error ? (
            <div className="p-space-md border border-error text-error bg-error/10 font-data-mono-sm text-data-mono-sm">{error}</div>
          ) : items.length === 0 ? (
            <div className="p-space-2xl text-center font-data-mono-sm text-data-mono-sm text-on-surface-variant bg-surface-container-low border border-surface-container">
              {mineOnly ? 'No upcoming deadlines among your saved calls. Bookmark calls on the dashboard to track them here.' : 'No upcoming deadlines yet.'}
            </div>
          ) : (
            months.map((month, idx) => (
              <div key={month} className="relative mb-space-xl sm:mb-space-2xl">
                <div className="flex items-center gap-space-sm mb-space-md sm:mb-space-lg">
                  <div className="absolute -left-[14px] sm:-left-[18px] lg:-left-[24px] flex items-center justify-center w-5 h-5 sm:w-6 sm:h-6 bg-surface">
                    <span className={`w-2 h-2 ${idx === 0 ? 'bg-primary' : 'bg-surface-container-highest'}`}></span>
                  </div>
                  <h2 className={`font-headline-md text-headline-md uppercase tracking-wider ${idx === 0 ? 'text-primary' : 'text-on-surface'}`}>{month}</h2>
                  <span className="h-px flex-1 bg-surface-container hidden sm:block"></span>
                </div>

                <div className="space-y-space-md">
                  {items
                    .filter((i) => monthLabel(i.deadline_date) === month)
                    .map((item) => {
                      const critical = item.days_left <= 7;
                      const soon = item.days_left > 7 && item.days_left <= 30;
                      return (
                        <div key={item.id} className="relative group bg-surface-container-low hover:bg-surface-container p-space-md transition-colors border border-surface-container">
                          <div className={`absolute -left-6 lg:-left-10 top-5 w-2 h-2 ${critical ? 'bg-error' : soon ? 'bg-primary' : 'bg-outline-variant'}`}></div>
                          <div className="flex flex-wrap items-center gap-space-sm mb-space-xs font-data-mono-sm text-data-mono-sm">
                            <span className="font-data-mono-md text-data-mono-md text-on-surface font-bold">{formatDeadline(item.deadline_date)}</span>
                            <span
                              className={`px-space-xs py-space-2xs tracking-wider font-bold ${
                                critical ? 'bg-error-container/30 text-error' : soon ? 'bg-primary-container/20 text-primary' : 'bg-surface-container text-on-surface-variant'
                              }`}
                            >
                              {item.days_left === 0 ? 'Today' : item.days_left === 1 ? 'Tomorrow' : `${item.days_left} days left`}
                            </span>
                            {item.confidence !== 'confirmed' && (
                              <span className="px-space-xs py-space-2xs bg-surface-container-high text-on-surface-variant" title="Read from the call document; confirm on the official page">
                                Date to confirm
                              </span>
                            )}
                            <span className="text-on-surface-variant uppercase">
                              {KIND_LABEL[item.kind] || item.kind} · {item.deadline_type.replace(/_/g, ' ')}
                            </span>
                          </div>
                          <Link
                            href={`/opportunities/${item.opportunity_id}`}
                            className="font-body-lg text-body-lg text-on-surface font-semibold hover:text-primary transition-colors"
                          >
                            {item.title}
                          </Link>
                          <div className="mt-space-xs pt-space-xs flex flex-wrap items-center justify-between gap-2 text-on-surface-variant font-data-mono-sm text-data-mono-sm border-t border-surface-container/60">
                            <span>{item.agency}</span>
                            {safeExternalUrl(item.source_url) && (
                              <a href={safeExternalUrl(item.source_url)} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                Official page
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            ))
          )}

          {nextCursor && !loading && (
            <button
              type="button"
              onClick={() => load(nextCursor, mineOnly).catch((err) => setError(`Could not load more: ${err.message}`))}
              className="font-data-mono-sm text-data-mono-sm text-primary hover:underline"
            >
              Load more
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
