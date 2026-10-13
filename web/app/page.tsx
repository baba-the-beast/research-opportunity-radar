'use client';

import { useEffect, useRef, useState } from 'react';
import { safeExternalUrl } from '@/lib/safeUrl';
import { formatDeadline, formatIstDateTime, relativeDays } from '@/lib/dates';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowserClient';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { SendToTelegram } from '@/components/SendToTelegram';
import { eligibilityLabel, eligibilityLine, type EligibilityVerdict } from '@/lib/eligibility';
import { callShareText } from '@/lib/share';
import { BANDS, BAND_RANK, bandLabel, bandTextClass, isGoodMatch, kindName } from '@/lib/match';
import { Icon, Notice, SegmentedControl, controlClass } from '@/components/ui';

// Code-split AiCopilot: only loaded when user opens the chat panel, not on every dashboard render.
// This reduces the / First Load JS by ~10-12 kB on constrained mobile data connections.
const AiCopilot = dynamic(() => import('@/components/AiCopilot').then((m) => ({ default: m.AiCopilot })), {
  ssr: false,
  loading: () => null
});

interface OpportunitySummary {
  id: string;
  kind: string;
  title: string;
  summary: string;
  agency_or_publisher: string;
  venue_name: string;
  primary_source_name: string;
  primary_source_url: string;
  next_deadline: { deadline_date: string; confidence: string; days_left: number } | null;
  lifecycle_status?: string; // open | forecasted | closed | unknown (no published deadline)
  is_expired?: boolean;
  final_score: number | null; // null until the pipeline scores this opportunity for the user
  band: string;
  matched_terms: string[];
  eligibility?: EligibilityVerdict | null;
  status: string;
  saved?: boolean;
}

interface PipelineRun {
  id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  opportunities_found: number;
  opportunities_new: number;
  error_count: number;
}

interface MyProfile {
  full_name: string;
  institution: string;
  department: string;
  research_keywords: string[];
}

interface ScanLogEvent {
  timestamp: string;
  agent: string;
  phase: string;
  level: string;
  message: string;
}



const SELECT =
  'min-h-11 sm:min-h-8 w-full sm:w-auto rounded-lg border border-outline bg-surface text-on-surface text-body-sm pl-2.5 pr-7 hover:border-on-surface-variant transition-colors';

const KINDS = [
  { value: 'all', label: 'All' },
  { value: 'funding', label: 'Funding' },
  { value: 'journal', label: 'Journals' },
  { value: 'venue', label: 'Conferences' }
] as const;

/** Deadline badge text and tone from the API's IST-based days_left. */
function deadlineBadge(opp: OpportunitySummary): { text: string; tone: 'urgent' | 'normal' | 'muted' } {
  if (opp.is_expired && opp.next_deadline) {
    return { text: `Closed ${formatDeadline(opp.next_deadline.deadline_date)}`, tone: 'muted' };
  }
  if (!opp.next_deadline) {
    return { text: opp.lifecycle_status === 'open' ? 'Open all year' : 'Deadline not published', tone: 'muted' };
  }
  const { days_left: days, deadline_date: date, confidence } = opp.next_deadline;
  const when = relativeDays(days);
  const approx = confidence === 'probable' ? ' (from call document)' : '';
  return { text: `Due ${formatDeadline(date)}, ${when}${approx}`, tone: days <= 7 ? 'urgent' : 'normal' };
}



export default function DashboardPage() {
  const [opportunities, setOpportunities] = useState<OpportunitySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<(typeof KINDS)[number]['value']>('all');
  const [minBand, setMinBand] = useState<string>('low');
  const [savedOnly, setSavedOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'score' | 'deadline'>('score');
  const [isOperator, setIsOperator] = useState(false);
  const [lastRun, setLastRun] = useState<PipelineRun | null>(null);
  const [me, setMe] = useState<MyProfile | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [logs, setLogs] = useState<ScanLogEvent[]>([]);
  const [search, setSearch] = useState('');
  // Unsearched first page, kept so the side rail shows real next deadlines while a search is active
  const [unsearched, setUnsearched] = useState<OpportunitySummary[]>([]);
  const [query, setQuery] = useState(''); // the search actually sent, 300 ms after typing stops
  const queryRef = useRef('');
  const requestSeq = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null);

  /** Loads a page of calls for the current search. A newer request makes older responses stale. */
  const loadOpportunities = async (cursor?: string) => {
    const seq = ++requestSeq.current;
    const params = new URLSearchParams({ limit: '30' });
    if (cursor) params.set('cursor', cursor);
    if (queryRef.current) params.set('q', queryRef.current);
    const res = await fetch(`/api/opportunities?${params}`);
    const body = await res.json();
    if (seq !== requestSeq.current) return;
    // List endpoints return { data: [...], pagination } (createSuccessResponse does not wrap)
    const items: OpportunitySummary[] = Array.isArray(body?.data) ? body.data : [];
    setNextCursor(body?.pagination?.next_cursor ?? null);
    setOpportunities((prev) => (cursor ? [...prev, ...items] : items));
    if (!queryRef.current) setUnsearched((prev) => (cursor ? [...prev, ...items] : items));
  };

  // Debounce typing into a search request
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (query === queryRef.current) return; // first render: the mount effect already loaded
    queryRef.current = query;
    setNextCursor(null); // the old cursor belongs to the previous search
    setLoading(true);
    loadOpportunities()
      .catch(() => setOpportunities([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // "/" jumps to search, unless the user is already typing somewhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      searchInput.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const loadLastRun = () =>
    fetch('/api/pipeline/status')
      .then(async (res) => {
        // The route returns the latest run itself, or null before the first scan
        const run = res.ok ? ((await res.json()) as PipelineRun | null) : null;
        setLastRun(run);
        return run;
      })
      .catch(() => null);

  useEffect(() => {
    loadOpportunities()
      .catch(() => setOpportunities([]))
      .finally(() => setLoading(false));
    loadLastRun();
    fetch('/api/profile')
      .then((res) => (res.ok ? res.json() : null))
      .then((prof) => {
        if (prof?.id) setMe({ full_name: prof.full_name, institution: prof.institution, department: prof.department, research_keywords: prof.research_keywords || [] });
      })
      .catch(() => {});
    try {
      getSupabaseBrowserClient()
        .auth.getUser()
        .then(({ data: { user } }) => {
          const role = (user?.app_metadata as any)?.role;
          setIsOperator(role === 'operator' || role === 'admin');
        });
    } catch {
      // Supabase not configured: no operator controls
    }
  }, []);

  const loadMore = async () => {
    if (!nextCursor || loading) return; // a new search is loading; its own first page replaces the list
    setLoadingMore(true);
    try {
      await loadOpportunities(nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  const log = (level: string, message: string, phase = 'SCAN') =>
    setLogs((prev) => [...prev, { timestamp: new Date().toISOString(), agent: 'Radar', phase, level, message }]);

  /**
   * Run a scan now (operators only): the server spawns the Python pipeline and streams its
   * progress as server-sent events, which are shown live in the scan log. Alerts are
   * suppressed so an on-demand scan does not send everyone an extra digest.
   */
  const triggerRescan = async () => {
    if (isStreaming) return;
    setIsStreaming(true);
    setLogs([]);
    let finished = false;
    try {
      const res = await fetch('/api/pipeline/stream?run=true&suppress_alerts=true');
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        log('ERROR', body?.error?.message || `Could not start the scan (HTTP ${res.status}).`, 'ERROR');
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const raw of events) {
          const data = raw.split('\n').find((line) => line.startsWith('data: '));
          if (!data) continue; // heartbeat comment
          let event: ScanLogEvent;
          try {
            event = JSON.parse(data.slice('data: '.length));
          } catch {
            continue;
          }
          setLogs((prev) => [...prev, event]);
          if (event.phase === 'COMPLETE' || event.phase === 'ERROR') finished = true;
        }
      }
      if (!finished) {
        log('WARN', 'Lost the connection to the scan; it keeps running on the server. Refresh later for results.', 'TIMEOUT');
      }
      await Promise.all([loadOpportunities(), loadLastRun()]);
    } catch (err: any) {
      log('ERROR', `Could not start the scan: ${err.message}`, 'ERROR');
    } finally {
      setIsStreaming(false);
    }
  };

  const toggleSave = async (oppId: string, currentSaved?: boolean) => {
    const nextSaved = !currentSaved;
    setOpportunities((prev) => prev.map((o) => (o.id === oppId ? { ...o, saved: nextSaved } : o)));
    try {
      await fetch('/api/opportunities/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportunity_id: oppId, saved: nextSaved })
      });
    } catch {
      setOpportunities((prev) => prev.map((o) => (o.id === oppId ? { ...o, saved: currentSaved } : o)));
    }
  };

  const filtersActive = kind !== 'all' || minBand !== 'low' || savedOnly;
  const resetFilters = () => {
    setKind('all');
    setMinBand('low');
    setSavedOnly(false);
  };

  const filteredOpps = opportunities
    .filter((o) => !savedOnly || Boolean(o.saved))
    .filter((o) => (BAND_RANK[o.band] ?? 3) <= BAND_RANK[minBand])
    .filter((o) => kind === 'all' || o.kind === kind)
    .sort((a, b) => {
      if (sortBy === 'score') return (b.final_score ?? -1) - (a.final_score ?? -1);
      if (!a.next_deadline?.deadline_date) return 1;
      if (!b.next_deadline?.deadline_date) return -1;
      return a.next_deadline.deadline_date.localeCompare(b.next_deadline.deadline_date);
    });

  const upcoming = (query ? unsearched : opportunities)
    .filter((o) => o.next_deadline && !o.is_expired && o.next_deadline.days_left >= 0)
    .sort((a, b) => a.next_deadline!.days_left - b.next_deadline!.days_left)
    .slice(0, 5);

  const savedCount = opportunities.filter((o) => o.saved).length;
  const strongCount = opportunities.filter((o) => o.band === 'high' || o.band === 'strong').length;
  const firstName = me?.full_name?.split(' ')[0];
  const headline =
    query
      ? 'Search results'
      : loading || opportunities.length === 0
      ? 'Calls for you'
      : `${strongCount} strong ${strongCount === 1 ? 'match' : 'matches'}${firstName ? ` for you, ${firstName}` : ' for you'}`;

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-8 pt-8 pb-24 sm:py-10 flex flex-col gap-8">
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-space-md">
        <div className="flex flex-col gap-space-2xs">
          <h1 className="font-headline-xl text-headline-lg sm:text-headline-xl text-on-surface">{headline}</h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-[72ch]">
            {lastRun?.finished_at
              ? `Last scan ${formatIstDateTime(lastRun.finished_at)}${lastRun.status === 'partial_failure' ? ' (some sources unavailable)' : ''}. `
              : lastRun?.status === 'running'
                ? 'Scan in progress. '
                : ''}
            New calls are found every Monday and Thursday morning (IST).
          </p>
        </div>
        {isOperator && (
          <button
            onClick={triggerRescan}
            disabled={isStreaming}
            className="h-9 px-4 rounded-lg bg-primary text-on-primary text-body-sm font-semibold hover:bg-primary-fixed transition-colors flex items-center gap-1.5 disabled:opacity-75"
          >
            <span className={`material-symbols-outlined text-[16px] ${isStreaming ? 'animate-spin' : ''}`}>
              {isStreaming ? 'sync' : 'radar'}
            </span>
            {isStreaming ? 'Scanning…' : 'Scan now'}
          </button>
        )}
      </div>

      {/* Scan log: only exists once an operator has started a scan */}
      {logs.length > 0 && (
        <details open className="rounded-2xl surface-card bg-surface">
          <summary className="px-space-md py-space-xs cursor-pointer font-body-sm text-body-sm text-on-surface">
            Scan log ({logs.length})
          </summary>
          <div className="px-space-md pb-space-sm max-h-48 overflow-y-auto font-data-mono-sm text-data-mono-sm flex flex-col gap-1">
            {logs.map((entry, idx) => (
              <div key={idx} className="flex gap-2">
                <span className="text-outline shrink-0">{entry.timestamp?.split('T')[1]?.slice(0, 8)}</span>
                <span className={entry.level === 'ERROR' ? 'text-error' : entry.level === 'SUCCESS' ? 'text-secondary' : 'text-on-surface-variant'}>
                  {entry.message}
                </span>
              </div>
            ))}
            {!isStreaming && (
              <button type="button" onClick={() => setLogs([])} className="self-start mt-1 text-on-surface-variant hover:text-on-surface">
                Clear log
              </button>
            )}
          </div>
        </details>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
        {/* Feed */}
        <section className="lg:col-span-8 flex flex-col gap-space-md min-w-0">
          {!loading && !me && (
            <div className="lg:hidden">
              <Notice tone="info" title="Set up your profile">
                Add your research interests so calls are ranked for you.{' '}
                <Link href="/profile" className="font-semibold underline underline-offset-4">
                  Set up profile
                </Link>
              </Notice>
            </div>
          )}

          {/* Search */}
          <div className="relative" role="search">
            <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none" />
            <label htmlFor="feed-search" className="sr-only">
              Search calls
            </label>
            <input
              ref={searchInput}
              id="feed-search"
              type="search"
              maxLength={100}
              autoComplete="off"
              placeholder="Search by title, funder or topic"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setSearch('');
              }}
              className={`${controlClass} pl-10 pr-10`}
            />
            {search ? (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  searchInput.current?.focus();
                }}
                aria-label="Clear search"
                className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-9 h-9 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
              >
                <Icon name="close" />
              </button>
            ) : (
              <kbd className="hidden sm:inline-flex absolute right-3 top-1/2 -translate-y-1/2 items-center justify-center w-6 h-6 rounded border border-outline-variant text-[12px] text-on-surface-variant" aria-hidden="true">
                /
              </kbd>
            )}
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
            <SegmentedControl label="Type of call" options={KINDS} value={kind} onChange={setKind} />
            <div className="grid grid-cols-[1fr_auto_1fr] gap-2 sm:contents">
            <select
              aria-label="Minimum match"
              value={minBand}
              onChange={(e) => setMinBand(e.target.value)}
              className={SELECT}
            >
              <option value="low">Any match</option>
              {BANDS.slice(0, 3).map((b) => (
                <option key={b.key} value={b.key}>
                  {b.label} ({b.cutoff})
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-pressed={savedOnly}
              title={`Show only saved calls (${savedCount})`}
              onClick={() => setSavedOnly(!savedOnly)}
              className={`min-h-11 sm:min-h-8 px-3 rounded-lg border text-body-sm flex items-center justify-center gap-1 transition-colors ${
                savedOnly
                  ? 'bg-primary-soft text-primary border-transparent font-semibold'
                  : 'border-outline bg-surface text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{savedOnly ? 'bookmark' : 'bookmark_border'}</span>
              <span className="sr-only sm:not-sr-only">Saved</span>
              <span className="tabular-nums">
                <span className="sm:hidden">{savedCount}</span>
                <span className="hidden sm:inline">({savedCount})</span>
              </span>
            </button>
            <select
              aria-label="Sort by"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'score' | 'deadline')}
              className={`${SELECT} sm:ml-auto`}
            >
              <option value="score">Best match</option>
              <option value="deadline">Deadline</option>
            </select>
            </div>
          </div>

          {/* List */}
          <div className="flex flex-col rounded-2xl border border-outline-variant divide-y divide-outline-variant bg-surface overflow-hidden">
            {loading ? (
              <p className="p-space-2xl text-center font-body-sm text-body-sm text-on-surface-variant">Loading calls…</p>
            ) : filteredOpps.length === 0 ? (
              <div className="p-space-2xl text-center font-body-sm text-body-sm text-on-surface-variant flex flex-col items-center gap-space-sm">
                {opportunities.length === 0 && query ? (
                  <>
                    <span>No calls match &ldquo;{query}&rdquo;. Try a shorter word or a funder name.</span>
                    <button type="button" onClick={() => setSearch('')} className="text-primary hover:underline">
                      Clear search
                    </button>
                  </>
                ) : opportunities.length === 0 ? (
                  <span>No calls yet. They appear after the next scan (Monday and Thursday mornings, IST).</span>
                ) : (
                  <>
                    <span>No calls match these filters.</span>
                    <button type="button" onClick={resetFilters} className="text-primary hover:underline">
                      Clear filters
                    </button>
                  </>
                )}
              </div>
            ) : (
              filteredOpps.map((opp) => {
                const badge = deadlineBadge(opp);
                const goodMatch = isGoodMatch(opp.band);
                return (
                  <article key={opp.id} className="px-5 py-5 sm:px-6 flex gap-5 hover:bg-surface-container-low transition-colors">
                    <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 font-body-sm text-body-sm">
                        <span className="font-semibold text-primary">{kindName(opp.kind, opp.lifecycle_status)}</span>
                        <span className="text-on-surface-variant truncate">
                          {opp.agency_or_publisher || opp.venue_name || opp.primary_source_name}
                        </span>
                      </div>
                      <Link href={`/opportunities/${opp.id}`} className="hover:text-primary transition-colors">
                        <h3 className="font-headline-sm text-headline-sm text-on-surface leading-snug max-w-[62ch]">{opp.title}</h3>
                      </Link>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 font-body-sm text-body-sm">
                        <span
                          className={`flex items-center gap-1 ${
                            badge.tone === 'urgent' ? 'text-error font-bold' : badge.tone === 'normal' ? 'text-on-surface' : 'text-outline'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[15px]">{badge.tone === 'urgent' ? 'timer' : 'event'}</span>
                          {badge.text}
                        </span>
                        {(() => {
                          const line = eligibilityLine(opp.eligibility);
                          if (!line) return null;
                          const label = eligibilityLabel(opp.eligibility);
                          return (
                            <span className={`flex items-center gap-1 ${label.tone === 'danger' ? 'text-error' : 'text-on-surface-variant'}`}>
                              <span className="material-symbols-outlined text-[15px]" aria-hidden="true">{label.icon}</span>
                              {line}
                            </span>
                          );
                        })()}
                        {opp.matched_terms.length > 0 && (
                          <span className="text-on-surface-variant truncate">Matches: {opp.matched_terms.slice(0, 3).join(', ')}</span>
                        )}
                        <a
                          href={safeExternalUrl(opp.primary_source_url)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-on-surface-variant underline decoration-outline-variant underline-offset-4 hover:text-primary hover:decoration-primary"
                        >
                          Official page
                        </a>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-space-xs shrink-0">
                      <div
                        className="flex flex-col items-end"
                        
                      >
                        <span className={`font-data-mono-lg text-data-mono-lg ${goodMatch ? 'text-primary' : 'text-on-surface-variant'}`}>
                          {opp.final_score === null ? '—' : Math.round(opp.final_score)}
                        </span>
                        <span
                          className={`mt-1 text-[12px] font-medium ${bandTextClass(opp.band)}`}
                        >
                          {bandLabel(opp.band)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleSave(opp.id, opp.saved)}
                        aria-pressed={Boolean(opp.saved)}
                        aria-label={opp.saved ? 'Remove from saved' : 'Save'}
                        title={opp.saved ? 'Remove from saved' : 'Save'}
                        className={`inline-flex items-center justify-center w-11 h-11 sm:w-9 sm:h-9 -mr-2 rounded-lg hover:bg-surface-container transition-colors ${
                          opp.saved ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[20px]">{opp.saved ? 'bookmark' : 'bookmark_border'}</span>
                      </button>
                      <SendToTelegram
                        iconOnly
                        className="-mr-2"
                        label={`Send "${opp.title}" to Telegram`}
                        text={callShareText(
                          {
                            id: opp.id,
                            title: opp.title,
                            publisher: opp.agency_or_publisher || opp.venue_name || opp.primary_source_name,
                            officialUrl: opp.primary_source_url,
                            deadline: opp.next_deadline && !opp.is_expired ? { date: opp.next_deadline.deadline_date, daysLeft: opp.next_deadline.days_left } : null
                          },
                          typeof window !== 'undefined' ? window.location.origin : undefined
                        )}
                      />
                    </div>
                  </article>
                );
              })
            )}
          </div>

          {(nextCursor || filteredOpps.length > 0) && (
            <div className="flex items-center justify-between font-body-sm text-body-sm text-on-surface-variant">
              <span>
                Showing {filteredOpps.length} of {opportunities.length} loaded calls
              </span>
              {nextCursor && (
                <button type="button" onClick={loadMore} disabled={loadingMore} className="text-primary hover:underline disabled:opacity-60">
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              )}
            </div>
          )}
        </section>

        {/* Side rail: profile and next deadlines */}
        <aside className="hidden lg:flex lg:col-span-4 flex-col gap-4">
          <div className="rounded-2xl surface-card bg-surface p-5 flex flex-col gap-space-sm">
            <div className="flex items-start justify-between gap-space-sm">
              <div className="min-w-0">
                <h2 className="font-headline-sm text-headline-sm text-on-surface">{me?.full_name || 'Set up your profile'}</h2>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  {me?.institution
                    ? [me.department, me.institution].filter(Boolean).join(' · ')
                    : 'Add your research interests so calls can be matched and ranked for you.'}
                </p>
              </div>
              <Link href="/profile" className="shrink-0 font-body-sm text-body-sm text-primary hover:underline">
                Edit
              </Link>
            </div>
            {me && me.research_keywords.length > 0 ? (
              <div className="flex flex-wrap gap-space-xs">
                {me.research_keywords.map((kw) => (
                  <span key={kw} className="rounded-full bg-surface-container px-2.5 py-0.5 font-body-sm text-body-sm text-on-surface">
                    {kw}
                  </span>
                ))}
              </div>
            ) : (
              me && (
                <Link href="/profile" className="font-body-sm text-body-sm text-primary hover:underline">
                  Add research keywords
                </Link>
              )
            )}
          </div>

          <div className="rounded-2xl surface-card bg-surface p-5 flex flex-col gap-space-md">
            <div className="flex items-baseline justify-between">
              <h2 className="font-headline-sm text-headline-sm text-on-surface">Next deadlines</h2>
              <Link href="/deadlines" className="font-body-sm text-body-sm text-primary hover:underline">
                See all
              </Link>
            </div>
            {upcoming.length === 0 ? (
              <p className="font-body-sm text-body-sm text-on-surface-variant">No upcoming deadlines among the loaded calls.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-outline-variant -my-3 [&>li]:py-3">
                {upcoming.map((opp) => {
                  const days = opp.next_deadline!.days_left;
                  const urgent = days <= 7;
                  return (
                    <li key={opp.id} className="flex flex-col gap-space-2xs">
                      <span className="flex items-baseline justify-between gap-2 font-body-sm text-body-sm">
                        <span className="text-on-surface-variant">{formatDeadline(opp.next_deadline!.deadline_date)}</span>
                        <span className={`font-data-mono-sm ${urgent ? 'text-error font-semibold' : 'text-on-surface-variant'}`}>
                          {days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'}`}
                        </span>
                      </span>
                      <Link
                        href={`/opportunities/${opp.id}`}
                        className="font-body-md text-body-md font-medium text-on-surface hover:text-primary transition-colors leading-snug"
                      >
                        {opp.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      </div>

      <AiCopilot />
    </div>
  );
}
