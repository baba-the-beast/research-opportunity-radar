'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatDeadline, formatIstDateTime } from '@/lib/dates';

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
        setDigest(body?.data ?? null);
      })
      .catch((err) => setError(`Could not load your digest: ${err.message}`))
      .finally(() => setLoading(false));
  }, []);

  const copyMarkdown = async () => {
    if (!digest?.markdown) return;
    try {
      await navigator.clipboard.writeText(digest.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy failed: your browser blocked clipboard access.');
    }
  };

  const items = (digest?.items || []).filter((i) => showAll || i.in_digest);

  return (
    <div className="w-full max-w-4xl mx-auto px-space-md sm:px-space-xl py-space-md sm:py-space-xl space-y-space-lg">
      <div className="flex flex-col gap-space-xs border-b border-surface-container pb-space-md">
        <span className="font-label-caps text-label-caps text-on-surface-variant tracking-widest uppercase">Digest</span>
        <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">Your latest digest</h1>
        <p className="font-body-md text-body-md text-on-surface-variant">
          Scans run on Monday and Thursday mornings (IST). After each scan, new calls that match your profile are sent to the
          channels chosen in <Link href="/settings" className="text-primary underline">Settings</Link>.
          {digest?.min_band && (
            <>
              {' '}
              Your filters: band <strong>{digest.min_band}</strong> or above, score at least <strong>{digest.min_score}</strong>{' '}
              (<Link href="/profile" className="text-primary underline">change</Link>).
            </>
          )}
        </p>
      </div>

      {loading ? (
        <p className="font-data-mono-sm text-data-mono-sm text-on-surface-variant">Loading...</p>
      ) : error ? (
        <div className="p-space-md border border-error text-error bg-error/10 font-data-mono-sm text-data-mono-sm">{error}</div>
      ) : !digest?.run ? (
        <p className="font-body-md text-body-md text-on-surface-variant">No scan has finished yet. Your first digest arrives after the next scheduled scan.</p>
      ) : digest.needs_profile ? (
        <p className="font-body-md text-body-md text-on-surface-variant">
          <Link href="/profile" className="text-primary underline">Set up your profile</Link> so calls can be matched to your research.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-space-sm font-data-mono-sm text-data-mono-sm text-on-surface-variant">
            <span>
              Scan of {digest.run.finished_at ? formatIstDateTime(digest.run.finished_at) : 'unknown time'}: {digest.run.opportunities_found} calls
              checked, {digest.run.opportunities_new} new
              {digest.run.status === 'partial_failure' && ' (some sources were unavailable)'}
            </span>
            <div className="flex items-center gap-space-md">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="accent-primary" />
                Show calls below my filters
              </label>
              <button type="button" onClick={copyMarkdown} className="text-primary hover:underline">
                {copied ? 'Copied' : 'Copy as text'}
              </button>
            </div>
          </div>

          {items.length === 0 ? (
            <p className="font-body-md text-body-md text-on-surface-variant bg-surface-container-low border border-surface-container p-space-md">
              No new calls passed your filters in this scan.
            </p>
          ) : (
            <ol className="space-y-space-sm">
              {items.map((item) => (
                <li
                  key={item.id}
                  className={`bg-surface-container-low border border-surface-container p-space-md flex flex-col gap-space-2xs ${item.in_digest ? '' : 'opacity-70'}`}
                >
                  <div className="flex flex-wrap items-center gap-space-sm font-data-mono-sm text-data-mono-sm text-on-surface-variant">
                    <span className="text-secondary font-bold">Score {item.score}</span>
                    <span className="uppercase">{item.band}</span>
                    <span>{item.agency}</span>
                    {!item.in_digest && <span>(below your filters)</span>}
                  </div>
                  <Link href={`/opportunities/${item.id}`} className="font-body-lg text-body-lg text-on-surface font-semibold hover:text-primary">
                    {item.title}
                  </Link>
                  <div className="flex flex-wrap items-center justify-between gap-2 font-data-mono-sm text-data-mono-sm text-on-surface-variant">
                    <span>
                      {item.deadline
                        ? `Due ${formatDeadline(item.deadline.date)} (${item.deadline.days_left} days)`
                        : 'Deadline not published'}
                      {item.matched_terms.length > 0 && ` · matches ${item.matched_terms.slice(0, 3).join(', ')}`}
                    </span>
                    {item.url && (
                      <a href={item.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        Official page
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
