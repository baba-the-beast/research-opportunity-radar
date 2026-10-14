'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { safeExternalUrl } from '@/lib/safeUrl';
import { formatDeadline, formatIstDateTime } from '@/lib/dates';
import { bandLabel, bandTextClass, isGoodMatch } from '@/lib/match';
import { SendToTelegram } from '@/components/SendToTelegram';
import { digestShareText } from '@/lib/share';
import { Button, EmptyState, LoadingRows, Notice, Page, PageHeader, Panel, buttonClass } from '@/components/ui';

interface DigestItem {
  id: string;
  title: string;
  kind: string;
  agency: string;
  url: string | null;
  score: number;
  band: string;
  matched_terms: string[];
  deadline: { date: string; days_left: number } | null;
  in_digest: boolean;
}

interface DigestData {
  run: { finished_at: string | null; status: string; opportunities_found: number; opportunities_new: number } | null;
  min_band?: string;
  min_score?: number;
  items: DigestItem[];
  markdown: string;
  needs_profile?: boolean;
}

export default function DigestsPage() {
  const [digest, setDigest] = useState<DigestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/digest/latest')
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
        setDigest(body ?? null);
      })
      .catch((err) => setError(`Your digest did not load (${err.message}). Refresh the page to try again.`))
      .finally(() => setLoading(false));
  }, []);

  const copyText = async () => {
    if (!digest?.markdown) return;
    try {
      await navigator.clipboard.writeText(digest.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy failed because the browser blocked clipboard access. Select the text and copy it instead.');
    }
  };

  const items = (digest?.items || []).filter((i) => showAll || i.in_digest);
  const hidden = (digest?.items || []).filter((i) => !i.in_digest).length;
  const ready = !loading && !error && digest?.run && !digest.needs_profile;

  return (
    <Page narrow>
      <PageHeader
        title="Latest digest"
        description={
          ready && digest?.run?.finished_at
            ? `From the scan on ${formatIstDateTime(digest.run.finished_at)}: ${digest.run.opportunities_found} calls checked, ${digest.run.opportunities_new} new.`
            : 'After each scan (Monday and Thursday mornings, IST) the new calls that match you are sent to you.'
        }
        actions={
          ready ? (
            <>
              {(digest?.items || []).some((i) => i.in_digest) && (
                <SendToTelegram
                  text={digestShareText(
                    (digest?.items || [])
                      .filter((i) => i.in_digest)
                      .map((i) => ({
                        id: i.id,
                        title: i.title,
                        publisher: i.agency,
                        officialUrl: i.url,
                        deadline: i.deadline ? { date: i.deadline.date, daysLeft: i.deadline.days_left } : null
                      }))
                  )}
                />
              )}
              <Button icon={copied ? 'check' : 'content_copy'} onClick={copyText} aria-live="polite">
                {copied ? 'Copied' : 'Copy as text'}
              </Button>
            </>
          ) : undefined
        }
      />

      {error && <Notice tone="danger">{error}</Notice>}
      {ready && digest?.run?.status === 'partial_failure' && (
        <Notice tone="warning">Some sources could not be reached during this scan, so a few calls may be missing.</Notice>
      )}

      {loading ? (
        <Panel>
          <LoadingRows rows={4} label="Loading digest" />
        </Panel>
      ) : error ? null : !digest?.run ? (
        <Panel>
          <EmptyState icon="schedule" title="No digest yet">
            Your first digest arrives after the next scheduled scan.
          </EmptyState>
        </Panel>
      ) : digest.needs_profile ? (
        <Panel>
          <EmptyState
            icon="person"
            title="Set up your profile first"
            action={
              <Link href="/profile" className={buttonClass('primary')}>
                Set up profile
              </Link>
            }
          >
            Your digest is built from your research interests.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 text-body-sm text-on-surface-variant">
            <p>
              {digest.min_band ? (
                <>
                  Showing {bandLabel(digest.min_band).toLowerCase()} or better
                  {digest.min_score ? `, score ${digest.min_score}+` : ''}.{' '}
                  <Link href="/settings" className="text-primary underline underline-offset-4">
                    Change
                  </Link>
                </>
              ) : (
                'New calls that match your profile.'
              )}
            </p>
            {hidden > 0 && (
              <label className="flex items-center gap-2 cursor-pointer min-h-11 sm:min-h-0">
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="w-4 h-4 accent-primary" />
                Include {hidden} below your threshold
              </label>
            )}
          </div>

          {items.length === 0 ? (
            <Panel>
              <EmptyState icon="inbox" title="Nothing new passed your threshold">
                No new calls in this scan scored high enough. Lower the threshold in Settings to see more.
              </EmptyState>
            </Panel>
          ) : (
            <ol className="rounded-2xl surface-card bg-surface divide-y divide-outline-variant overflow-hidden">
              {items.map((item) => {
                const href = safeExternalUrl(item.url);
                return (
                  <li key={item.id} className={`px-5 sm:px-6 py-5 flex gap-5 ${item.in_digest ? '' : 'bg-surface-container-low'}`}>
                    <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                      <span className="text-body-sm text-on-surface-variant">
                        {item.agency}
                        {!item.in_digest && ' · below your threshold'}
                      </span>
                      <Link href={`/opportunities/${item.id}`} className="text-headline-sm font-semibold text-on-surface hover:text-primary leading-snug">
                        {item.title}
                      </Link>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-on-surface-variant">
                        <span>
                          {item.deadline
                            ? `Due ${formatDeadline(item.deadline.date)}, in ${item.deadline.days_left} days`
                            : 'Deadline not published'}
                        </span>
                        {item.matched_terms.length > 0 && <span>Matches: {item.matched_terms.slice(0, 3).join(', ')}</span>}
                        {href && (
                          <a href={href} target="_blank" rel="noreferrer" className="text-primary hover:underline underline-offset-4">
                            Official call page
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span className={`font-data-mono-lg text-data-mono-lg ${isGoodMatch(item.band) ? 'text-primary' : 'text-on-surface-variant'}`}>
                        {Math.round(item.score)}
                      </span>
                      <span className={`mt-1 text-[12px] font-medium ${bandTextClass(item.band)}`}>{bandLabel(item.band)}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </Page>
  );
}
