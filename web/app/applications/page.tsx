'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { daysUntil, formatDeadline, relativeDays } from '@/lib/dates';
import { safeExternalUrl } from '@/lib/safeUrl';
import { STAGE, type ApplicationStatus } from '@/lib/applications';
import { Badge, EmptyState, LoadingRows, Notice, Page, PageHeader, Panel, buttonClass } from '@/components/ui';

interface ApplicationRow {
  id: string;
  title: string;
  kind: string;
  publisher: string;
  official_url: string | null;
  status: ApplicationStatus;
  notes: string;
  my_deadline: string | null;
  my_deadline_label: string;
  updated_at: string;
  next_deadline: { date: string; type: string; confidence: string; days_left: number } | null;
}

const GROUPS: { key: string; title: string; statuses: ApplicationStatus[]; empty: string }[] = [
  { key: 'preparing', title: 'Preparing', statuses: ['pursuing'], empty: 'Nothing in preparation.' },
  { key: 'submitted', title: 'Submitted', statuses: ['applied'], empty: 'Nothing waiting for a result.' },
  { key: 'results', title: 'Results', statuses: ['awarded', 'not_awarded'], empty: 'No results recorded yet.' }
];

/** Soonest deadline first; calls without one go last, most recently updated first. */
function byDeadline(a: ApplicationRow, b: ApplicationRow) {
  if (a.next_deadline && b.next_deadline) return a.next_deadline.date.localeCompare(b.next_deadline.date);
  if (a.next_deadline) return -1;
  if (b.next_deadline) return 1;
  return b.updated_at.localeCompare(a.updated_at);
}

export default function ApplicationsPage() {
  const [rows, setRows] = useState<ApplicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/applications')
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
        setRows(Array.isArray(body?.data) ? body.data : []);
      })
      .catch((err) => setError(`Your applications did not load (${err.message}). Refresh the page to try again.`))
      .finally(() => setLoading(false));
  }, []);

  const count = (statuses: ApplicationStatus[]) => rows.filter((r) => statuses.includes(r.status)).length;
  const funded = count(['awarded']);
  const decided = count(['awarded', 'not_awarded']);

  return (
    <Page narrow>
      <PageHeader
        title="Applications"
        description={
          loading || rows.length === 0
            ? 'Calls you are applying to, from preparation to result.'
            : `${count(['pursuing'])} preparing, ${count(['applied'])} submitted${decided ? `, ${funded} of ${decided} funded` : ''}.`
        }
      />

      {error && <Notice tone="danger">{error}</Notice>}

      {loading ? (
        <Panel>
          <LoadingRows rows={3} label="Loading applications" />
        </Panel>
      ) : rows.length === 0 && !error ? (
        <Panel>
          <EmptyState
            icon="assignment"
            title="No applications yet"
            action={
              <Link href="/" className={buttonClass('primary')}>
                Find a call
              </Link>
            }
          >
            Open a call and choose &ldquo;I&apos;m applying&rdquo;. It appears here, and you can track it through to the result.
          </EmptyState>
        </Panel>
      ) : (
        GROUPS.map((group) => {
          const items = rows.filter((r) => group.statuses.includes(r.status)).sort(byDeadline);
          if (items.length === 0 && group.key === 'results') return null;
          return (
            <section key={group.key} className="flex flex-col gap-3" aria-labelledby={`g-${group.key}`}>
              <h2 id={`g-${group.key}`} className="font-headline-sm text-headline-sm text-on-surface">
                {group.title} <span className="text-on-surface-variant font-normal tabular-nums">{items.length}</span>
              </h2>
              {items.length === 0 ? (
                <p className="text-body-sm text-on-surface-variant">{group.empty}</p>
              ) : (
                <ul className="rounded-2xl surface-card bg-surface divide-y divide-outline-variant overflow-hidden">
                  {items.map((item) => {
                    const dl = item.next_deadline;
                    const urgent = dl && dl.days_left <= 7;
                    const href = safeExternalUrl(item.official_url);
                    const firstNote = item.notes.split('\n').find((l) => l.trim());
                    return (
                      <li key={item.id} className="px-5 sm:px-6 py-4 flex flex-col gap-1.5 hover:bg-surface-container-low transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <Link href={`/opportunities/${item.id}`} className="text-body-md font-semibold text-on-surface hover:text-primary leading-snug">
                            {item.title}
                          </Link>
                          {group.key === 'results' && <Badge tone={STAGE[item.status].tone}>{STAGE[item.status].short}</Badge>}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-on-surface-variant">
                          {item.publisher && <span>{item.publisher}</span>}
                          {group.key !== 'results' && (
                            <span className={urgent ? 'text-error font-semibold' : ''}>
                              {dl
                                ? `${dl.type.charAt(0).toUpperCase()}${dl.type.slice(1).replace(/_/g, ' ')}: ${formatDeadline(dl.date)}, ${relativeDays(dl.days_left)}`
                                : 'No upcoming deadline'}
                            </span>
                          )}
                          {href && (
                            <a href={href} target="_blank" rel="noreferrer" className="text-primary hover:underline underline-offset-4">
                              Official call page
                            </a>
                          )}
                        </div>
                        {group.key !== 'results' && item.my_deadline && (() => {
                          const d = daysUntil(item.my_deadline);
                          return (
                            <p className={`text-body-sm ${d >= 0 && d <= 7 ? 'text-error font-semibold' : 'text-on-surface'}`}>
                              <span className="font-semibold">{item.my_deadline_label || 'Your deadline'}:</span> {formatDeadline(item.my_deadline)},{' '}
                              {relativeDays(d)}
                            </p>
                          );
                        })()}
                        {firstNote && (
                          <p className="text-body-sm text-on-surface line-clamp-1">
                            <span className="text-on-surface-variant">Note: </span>
                            {firstNote}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })
      )}
    </Page>
  );
}
