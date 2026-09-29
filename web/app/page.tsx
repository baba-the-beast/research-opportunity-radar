'use client';

import { useEffect, useState, useCallback } from 'react';
import { formatDeadline, formatIstDateTime } from '@/lib/dates';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowserClient';
import Link from 'next/link';
import dynamic from 'next/dynamic';

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

interface AgentTelemetryLog {
  timestamp: string;
  agent: string;
  phase: string;
  level: string;
  message: string;
  stepIndex?: number;
  payload?: any;
}

const INITIAL_LOGS: AgentTelemetryLog[] = [
  {
    timestamp: new Date(0).toISOString(),
    agent: 'Radar',
    phase: 'SYSTEM',
    level: 'INFO',
    stepIndex: 1,
    message: 'Scans run automatically on Monday and Thursday mornings (IST). New matches arrive in your digest.'
  }
];

const RESCAN_POLL_MS = 15_000;
const RESCAN_MAX_WAIT_MS = 30 * 60_000;

/** Deadline badge text and tone from the API's IST-based days_left. */
function deadlineBadge(opp: OpportunitySummary): { text: string; tone: 'urgent' | 'normal' | 'muted' } {
  if (opp.is_expired && opp.next_deadline) {
    return { text: `Closed ${formatDeadline(opp.next_deadline.deadline_date)}`, tone: 'muted' };
  }
  if (!opp.next_deadline) {
    return { text: opp.lifecycle_status === 'open' ? 'Open all year' : 'Deadline not published', tone: 'muted' };
  }
  const { days_left: days, deadline_date: date, confidence } = opp.next_deadline;
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  const approx = confidence === 'probable' ? ' (from call document)' : '';
  return { text: `Due ${formatDeadline(date)}, ${when}${approx}`, tone: days <= 7 ? 'urgent' : 'normal' };
}

function kindLabel(opp: OpportunitySummary): string {
  if (opp.kind === 'journal') return 'Journal call for papers';
  if (opp.kind === 'venue') return 'Conference call for papers';
  if (opp.lifecycle_status === 'forecasted') return 'Funding call — opens soon';
  return 'Funding call';
}

export default function DashboardPage() {
  const [opportunities, setOpportunities] = useState<OpportunitySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterBands, setFilterBands] = useState<Record<string, boolean>>({
    high: true,
    strong: true,
    watch: true,
    low: true
  });
  const [filterKind, setFilterKind] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'score' | 'deadline'>('score');
  const [isOperator, setIsOperator] = useState(false);
  const [lastRun, setLastRun] = useState<PipelineRun | null>(null);
  const [me, setMe] = useState<MyProfile | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [rescanTriggered, setRescanTriggered] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [activeStep, setActiveStep] = useState(1);
  const [activePhase, setActivePhase] = useState('IDLE');
  const [logs, setLogs] = useState<AgentTelemetryLog[]>(INITIAL_LOGS);
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
  const [liteMode, setLiteMode] = useState(false);
  const [showSlowConnBanner, setShowSlowConnBanner] = useState(false);

  // Detect lite/save-data mode: ?lite=1 param, saveData flag, or 2G/3G effective connection type
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlLite = new URLSearchParams(window.location.search).get('lite') === '1';
      const nav = (navigator as any);
      const saveData = nav.connection?.saveData === true;
      const slowConn = nav.connection?.effectiveType === '2g' || nav.connection?.effectiveType === '3g';
      if (urlLite || saveData || slowConn) {
        setLiteMode(true);
      }
    }
  }, []);


  const loadOpportunities = async (cursor?: string) => {
    const params = new URLSearchParams({ limit: '30' });
    if (cursor) params.set('cursor', cursor);
    const res = await fetch(`/api/opportunities?${params}`);
    const body = await res.json();
    const page = body?.data;
    const items: OpportunitySummary[] = Array.isArray(page?.data) ? page.data : Array.isArray(page) ? page : [];
    setNextCursor(page?.pagination?.next_cursor ?? null);
    setOpportunities((prev) => (cursor ? [...prev, ...items] : items));
  };

  const loadLastRun = () =>
    fetch('/api/pipeline/status')
      .then((res) => res.json())
      .then((body) => {
        setLastRun(body?.data ?? null);
        return (body?.data ?? null) as PipelineRun | null;
      })
      .catch(() => null);

  useEffect(() => {
    loadOpportunities()
      .catch(() => setOpportunities([]))
      .finally(() => setLoading(false));
    loadLastRun();
    fetch('/api/profile')
      .then((res) => res.json())
      .then((body) => {
        const prof = body?.data;
        if (prof) setMe({ full_name: prof.full_name, institution: prof.institution, department: prof.department, research_keywords: prof.research_keywords || [] });
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
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      await loadOpportunities(nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  const log = (level: string, message: string, phase = 'SCAN') =>
    setLogs((prev) => [...prev, { timestamp: new Date().toISOString(), agent: 'Radar', phase, level, stepIndex: 1, message }]);

  /** Start a scan on GitHub Actions (operators only) and poll run_log until it finishes. */
  const triggerRescan = async () => {
    if (isStreaming) return;
    setRescanTriggered(true);
    setIsStreaming(true);
    setConsoleOpen(true);
    setActivePhase('DISPATCH');
    const previousRunId = lastRun?.id;
    try {
      const res = await fetch('/api/pipeline/trigger', { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        log('ERROR', body?.error?.message || `Could not start the scan (HTTP ${res.status}).`, 'ERROR');
        return;
      }
      log('INFO', 'Scan started on GitHub Actions. This usually takes 5-15 minutes; you can leave this page.');
      const started = Date.now();
      while (Date.now() - started < RESCAN_MAX_WAIT_MS) {
        await new Promise((resolve) => setTimeout(resolve, RESCAN_POLL_MS));
        const run = await loadLastRun();
        if (!run || run.id === previousRunId) continue;
        if (run.status === 'running') {
          setActivePhase('RUNNING');
          continue;
        }
        const summary = `${run.opportunities_found} calls checked, ${run.opportunities_new} new`;
        log(run.status === 'success' ? 'SUCCESS' : 'WARN',
          run.status === 'success' ? `Scan finished: ${summary}.` : `Scan finished with problems (${run.error_count} issues): ${summary}.`, 'COMPLETE');
        setActivePhase('COMPLETE');
        await loadOpportunities();
        return;
      }
      log('WARN', 'The scan is taking longer than usual. Check the Actions tab on GitHub, or refresh later.', 'TIMEOUT');
    } catch (err: any) {
      log('ERROR', `Could not start the scan: ${err.message}`, 'ERROR');
    } finally {
      setIsStreaming(false);
      setRescanTriggered(false);
    }
  };

  const [savedOnly, setSavedOnly] = useState(false);

  const toggleSave = async (e: React.MouseEvent, oppId: string, currentSaved?: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    const nextSaved = !currentSaved;
    setOpportunities((prev) =>
      prev.map((o) => (o.id === oppId ? { ...o, saved: nextSaved } : o))
    );

    try {
      await fetch('/api/opportunities/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportunity_id: oppId, saved: nextSaved })
      });
    } catch {
      setOpportunities((prev) =>
        prev.map((o) => (o.id === oppId ? { ...o, saved: currentSaved } : o))
      );
    }
  };

  const toggleBand = (b: string) => {
    setFilterBands((prev) => ({ ...prev, [b]: !prev[b] }));
  };

  const filteredOpps = opportunities
    .filter((o) => !savedOnly || Boolean(o.saved))
    .filter((o) => filterBands[o.band] ?? true)
    .filter((o) => filterKind === 'all' || o.kind.toLowerCase().includes(filterKind.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'score') return (b.final_score ?? -1) - (a.final_score ?? -1);
      if (!a.next_deadline?.deadline_date) return 1;
      if (!b.next_deadline?.deadline_date) return -1;
      return a.next_deadline.deadline_date.localeCompare(b.next_deadline.deadline_date);
    });

  const upcoming = opportunities
    .filter((o) => o.next_deadline && !o.is_expired && o.next_deadline.days_left >= 0)
    .sort((a, b) => a.next_deadline!.days_left - b.next_deadline!.days_left)
    .slice(0, 6);

  const countByBand = (b: string) => opportunities.filter((o) => o.band === b).length;

  return (
    <div className="flex flex-col w-full">
      {/* Slow-Connection Warning Banner (India 2G/3G/congested WiFi) */}
      {showSlowConnBanner && (
        <div className="w-full bg-tertiary-container/80 border-b border-tertiary/30 px-space-md py-space-xs flex items-center gap-space-sm text-on-tertiary-container font-data-mono-sm text-data-mono-sm">
          <span className="material-symbols-outlined text-[16px] shrink-0">wifi_tethering</span>
          <span>Connecting to academic feeds... this may take a moment on slower connections.</span>
          <button
            type="button"
            className="ml-auto text-on-tertiary-container/60 hover:text-on-tertiary-container"
            onClick={() => setShowSlowConnBanner(false)}
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
      )}

      {/* Lite Mode Badge (low-bandwidth / Save Data mode) */}
      {liteMode && (
        <div className="w-full bg-secondary-container/70 border-b border-secondary/30 px-space-md py-space-xs flex items-center gap-space-sm text-on-secondary-container font-data-mono-sm text-data-mono-sm">
          <span className="material-symbols-outlined text-[14px] shrink-0">bolt</span>
          <span>⚡ Lite Mode Active — Radar visualizations hidden to reduce data usage.</span>
          <button
            type="button"
            className="ml-auto underline text-on-secondary-container/80 hover:text-on-secondary-container text-[11px]"
            onClick={() => setLiteMode(false)}
          >
            Show Full View
          </button>
        </div>
      )}

      {/* Top Observatory Telemetry Bar */}
      <div className="w-full bg-surface-container-lowest px-space-md sm:px-space-xl py-space-xs sm:py-space-sm flex flex-wrap items-center justify-between gap-space-sm sm:gap-space-md border-b border-surface-container">
        <div className="flex items-center gap-space-sm sm:gap-space-lg flex-wrap">
          <div className="flex items-center gap-space-xs font-label-caps text-label-caps text-on-surface-variant">
            <span className="w-2 h-2 bg-primary-container inline-block"></span>
            <span className="tracking-widest uppercase text-primary">Opportunity radar</span>
          </div>
          <span className="font-data-mono-sm text-data-mono-sm text-outline">
            {lastRun?.finished_at
              ? `Last scan: ${formatIstDateTime(lastRun.finished_at)}${lastRun.status === 'partial_failure' ? ' (some sources unavailable)' : ''}`
              : lastRun?.status === 'running'
                ? 'Scan in progress...'
                : 'No scan yet'}
          </span>
        </div>
        <div className="flex items-center gap-space-sm sm:gap-space-md font-data-mono-sm text-data-mono-sm flex-wrap">
          {isOperator && (
            <button
              onClick={triggerRescan}
              disabled={isStreaming}
              className="text-on-primary bg-primary-container px-space-md py-space-2xs font-label-caps text-label-caps tracking-wider uppercase hover:bg-primary transition-colors flex items-center gap-1 disabled:opacity-75 cursor-pointer"
            >
              {isStreaming ? (
                <>
                  <span className="material-symbols-outlined text-[13px] animate-spin">sync</span>
                  <span>Scan running...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[13px]">radar</span>
                  <span>Scan now</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Observatory Agent Reasoning Console (Live Telemetry Stream) */}
      <div className="w-full bg-surface-container-lowest border-b border-surface-container flex flex-col transition-all">
        {/* Console Header Bar */}
        <div className="px-space-md sm:px-space-xl py-space-xs flex flex-wrap items-center justify-between gap-space-sm sm:gap-space-md bg-surface-container-low/50 border-b border-surface-container">
          <div className="flex items-center gap-space-md flex-wrap">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isStreaming ? 'bg-primary animate-ping' : 'bg-secondary'}`}></span>
              <span className="font-label-caps text-label-caps font-bold tracking-widest text-on-surface uppercase">
                Observatory Multi-Agent Reasoning Console
              </span>
            </div>
            <div className="h-3 w-px bg-surface-container-high hidden sm:block"></div>
            <span className="font-data-mono-sm text-data-mono-sm">
              {isStreaming ? (
                <span className="text-primary font-bold animate-pulse">● LIVE STREAMING TELEMETRY (PHASE: {activePhase})</span>
              ) : (
                <span className="text-secondary">● SYNCHRONIZED ({logs.length} AUDIT TRACES)</span>
              )}
            </span>
          </div>

          {/* Multi-Agent Pipeline Stage Progress Tracker */}
          <div className="hidden lg:flex items-center gap-space-xs font-data-mono-sm text-data-mono-sm">
            <span className={`px-2 py-0.5 border ${activeStep >= 1 ? 'border-primary text-primary bg-primary/10 font-bold' : 'border-surface-container text-outline'}`}>
              01. SEARCH & DISCOVERY
            </span>
            <span className="text-outline">→</span>
            <span className={`px-2 py-0.5 border ${activeStep >= 2 ? 'border-secondary text-secondary bg-secondary/10 font-bold' : 'border-surface-container text-outline'}`}>
              02. ELIGIBILITY GATEWAY
            </span>
            <span className="text-outline">→</span>
            <span className={`px-2 py-0.5 border ${activeStep >= 3 ? 'border-primary text-primary bg-primary/10 font-bold' : 'border-surface-container text-outline'}`}>
              03. RESONANCE ENGINE
            </span>
            <span className="text-outline">→</span>
            <span className={`px-2 py-0.5 border ${activeStep >= 4 ? 'border-secondary text-secondary bg-secondary/10 font-bold' : 'border-surface-container text-outline'}`}>
              04. CORPUS ADMISSION
            </span>
          </div>

          {/* Drawer Controls */}
          <div className="flex items-center gap-space-sm">
            <button
              onClick={() => setLogs(INITIAL_LOGS)}
              className="font-data-mono-sm text-data-mono-sm text-outline hover:text-on-surface transition-colors"
              title="Reset Console Logs"
            >
              Reset
            </button>
            <button
              onClick={() => setConsoleOpen(!consoleOpen)}
              className="flex items-center gap-1 font-label-caps text-label-caps uppercase tracking-wider text-primary hover:text-on-surface transition-colors border border-surface-container px-2 py-0.5 bg-surface-container-lowest"
            >
              <span>{consoleOpen ? 'Collapse Traces ▲' : 'Expand Traces ▼'}</span>
            </button>
          </div>
        </div>

        {/* Terminal Log Stream Window */}
        {consoleOpen && (
          <div className="p-space-md bg-[#080a0f] font-data-mono-sm text-data-mono-sm text-on-surface-variant max-h-48 overflow-y-auto flex flex-col gap-1.5 scrollbar-thin">
            {logs.map((log, idx) => {
              const time = log.timestamp ? log.timestamp.split('T')[1]?.slice(0, 8) : '00:00:00';
              const isError = log.level === 'ERROR';
              const isSuccess = log.level === 'SUCCESS';
              const isWarning = log.level === 'WARNING';

              return (
                <div key={idx} className="flex items-start gap-2 leading-relaxed font-mono">
                  <span className="text-outline shrink-0">[{time}]</span>
                  <span className={`shrink-0 font-bold ${
                    log.agent === 'DiscoveryAgent'
                      ? 'text-primary'
                      : log.agent === 'EligibilityAgent'
                      ? 'text-secondary'
                      : log.agent === 'ScoringAgent'
                      ? 'text-[#e5c07b]'
                      : 'text-on-surface'
                  }`}>
                    [{log.agent}]
                  </span>
                  <span className={`shrink-0 text-xs px-1 border ${
                    log.phase === 'DISCOVERY' ? 'border-primary/40 text-primary' :
                    log.phase === 'COMPLIANCE' ? 'border-secondary/40 text-secondary' :
                    log.phase === 'RESONANCE' ? 'border-[#e5c07b]/40 text-[#e5c07b]' :
                    'border-surface-container text-outline'
                  }`}>
                    {log.phase}
                  </span>
                  <span className={`flex-1 ${
                    isError ? 'text-error font-bold' :
                    isSuccess ? 'text-[#98c379]' :
                    isWarning ? 'text-primary font-semibold' :
                    'text-[#abb2bf]'
                  }`}>
                    {log.message}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Asymmetric 3-Column Instrument Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 w-full min-h-[calc(100vh-8.5rem)]">
        {/* Left Rail: Fixed Faculty Profile & Filter Vector */}
        <section className="lg:col-span-3 bg-surface-container-lowest p-space-md sm:p-space-lg flex flex-col gap-space-md sm:gap-space-lg lg:gap-space-xl border-b lg:border-b-0 lg:border-r border-surface-container">
          {/* Your profile */}
          <div className="flex items-start justify-between gap-space-sm">
            <div className="flex flex-col min-w-0">
              <span className="font-data-mono-sm text-data-mono-sm text-primary uppercase tracking-wider">Your profile</span>
              <h2 className="font-headline-md text-headline-md text-on-surface font-bold leading-tight mt-0.5">
                {me?.full_name || 'Set up your profile'}
              </h2>
              <p className="font-body-sm text-body-sm text-on-surface-variant leading-tight mt-0.5">
                {me?.institution
                  ? [me.department, me.institution].filter(Boolean).join(' · ')
                  : 'Add your research interests so calls can be matched and ranked for you.'}
              </p>
            </div>
            <Link href="/profile" className="shrink-0 font-data-mono-sm text-data-mono-sm text-primary hover:underline">
              Edit
            </Link>
          </div>

          <div className="flex flex-col gap-space-xs">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">
              Research keywords ({me?.research_keywords.length ?? 0})
            </span>
            <div className="flex items-center gap-space-xs overflow-x-auto no-scrollbar py-0.5 -mx-space-md px-space-md lg:mx-0 lg:px-0 lg:flex-wrap" id="keyword-cluster">
              {(me?.research_keywords || []).map((kw) => (
                <span
                  key={kw}
                  className="shrink-0 bg-surface-container-low px-space-sm py-space-2xs font-data-mono-sm text-data-mono-sm text-on-surface border border-surface-container"
                >
                  {kw}
                </span>
              ))}
              {me && me.research_keywords.length === 0 && (
                <Link href="/profile" className="font-data-mono-sm text-data-mono-sm text-primary hover:underline">
                  Add keywords
                </Link>
              )}
            </div>
          </div>

          {/* Filter Metric Bands (Matrix Selector from Stitch mobile feed) */}
          <div className="flex flex-col gap-1.5 pt-space-xs">
            <div className="flex items-center justify-between">
              <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">Filter Metric Bands</span>
              <button
                type="button"
                onClick={() => setFilterBands({ high: true, strong: true, watch: true, low: true })}
                className="font-data-mono-sm text-data-mono-sm text-outline hover:text-primary transition-colors cursor-pointer"
              >
                [Reset Matrix]
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {(
                [
                  { key: 'high', label: 'HIGH', cutoff: '(80+)' },
                  { key: 'strong', label: 'STRONG', cutoff: '(65+)' },
                  { key: 'watch', label: 'WATCH', cutoff: '(50+)' },
                  { key: 'low', label: 'LOW', cutoff: '(<50)' }
                ] as const
              ).map(({ key, label, cutoff }) => {
                const active = filterBands[key];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleBand(key)}
                    className={`h-7 px-1 font-label-caps text-label-caps flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1 transition-colors border ${
                      active
                        ? key === 'high' || key === 'strong'
                          ? 'bg-secondary-container text-on-secondary-container border-secondary/40 font-bold'
                          : 'bg-surface-container-highest text-on-surface border-outline-variant font-bold'
                        : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface border-surface-container'
                    }`}
                  >
                    <span>{label}</span>
                    <span className="font-data-mono-sm text-[9px] sm:text-[10px] opacity-80">{cutoff}</span>
                  </button>
                );
              })}
            </div>

            {/* Modality Strip */}
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pt-1">
              <span className="font-label-caps text-label-caps text-outline uppercase shrink-0 mr-1 hidden sm:inline">Modality:</span>
              {(['all', 'journal', 'venue', 'funding'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setFilterKind(m)}
                  className={`h-6 px-2.5 font-label-caps text-label-caps uppercase shrink-0 transition-colors ${
                    filterKind === m
                      ? 'bg-primary-container text-on-primary font-bold'
                      : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {m === 'all' ? `ALL (${opportunities.length})` : `${m.toUpperCase()} (${opportunities.filter(o => o.kind === m).length})`}
                </button>
              ))}
            </div>
          </div>

          {/* Saved Bookmarks Filter */}
          <div className="flex flex-col gap-space-sm pt-2 border-t border-surface-container/60">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">
              Saved Horizon
            </span>
            <button
              onClick={() => setSavedOnly(!savedOnly)}
              className={`px-3 py-2 text-center text-body-sm font-bold flex items-center justify-between transition-colors rounded ${
                savedOnly
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container border border-outline-variant/40 text-on-surface hover:bg-surface-container-high'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">
                  {savedOnly ? 'bookmark' : 'bookmark_border'}
                </span>
                <span>Saved Calls Only</span>
              </div>
              <span className="font-data-mono-sm text-data-mono-sm">
                0{opportunities.filter((o) => o.saved).length}
              </span>
            </button>
          </div>

          {/* Telemetry Radar Geometry Display (Desktop & Tablet) — hidden in lite mode to save bandwidth */}
          {!liteMode && (
          <div className="hidden md:flex flex-col gap-space-xs">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">
              Telemetry Radar Geometry
            </span>
            <div className="w-full bg-surface-container-low p-space-md flex flex-col items-center justify-center relative overflow-hidden border border-surface-container">
              <svg
                className="w-40 h-40 text-surface-container-highest"
                fill="none"
                viewBox="0 0 160 160"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="80" cy="80" r="70" stroke="currentColor" strokeDasharray="2 2" strokeWidth="1"></circle>
                <circle cx="80" cy="80" r="48" stroke="currentColor" strokeWidth="1"></circle>
                <circle cx="80" cy="80" r="24" stroke="currentColor" strokeDasharray="2 2" strokeWidth="1"></circle>
                <line stroke="currentColor" strokeWidth="1" x1="80" x2="80" y1="5" y2="155"></line>
                <line stroke="currentColor" strokeWidth="1" x1="5" x2="155" y1="80" y2="80"></line>
                <polygon fill="#5B8C7B" points="80,24 84,28 80,32 76,28"></polygon>
                <polygon fill="#B5482F" points="112,68 116,72 112,76 108,72"></polygon>
                <polygon fill="#C08A3E" points="98,102 102,106 98,110 94,106"></polygon>
                <polygon fill="#5B8C7B" points="56,92 60,96 56,100 52,96"></polygon>
                <polygon fill="#9d8e7f" points="44,52 48,56 44,60 40,56"></polygon>
                <line opacity="0.6" stroke="#C08A3E" strokeWidth="1" x1="80" x2="135" y1="80" y2="35"></line>
              </svg>
              <div className="w-full flex justify-between font-data-mono-sm text-data-mono-sm text-on-surface-variant mt-space-xs">
                <span>SCAN RADIUS: 5.2k</span>
                <span className="text-primary font-bold">VECT_MATCH 86%</span>
              </div>
            </div>
          </div>
          )}
        </section>

        {/* Center Column: The Radar Stream */}
        <section className="lg:col-span-6 bg-surface-container-low flex flex-col border-r border-surface-container">
          <div className="h-10 px-space-lg bg-surface-container flex items-center justify-between border-b border-surface-container">
            <div className="flex items-center gap-space-md">
              <span className="font-label-caps text-label-caps uppercase tracking-wider text-on-surface">
                Observatory Opportunity Stream
              </span>
              <span className="font-data-mono-sm text-data-mono-sm text-outline">
                0{filteredOpps.length} DETECTED CANDIDATES
              </span>
            </div>
            <div className="flex items-center gap-space-sm font-data-mono-sm text-data-mono-sm text-on-surface-variant">
              <span>SORT:</span>
              <button
                onClick={() => setSortBy(sortBy === 'score' ? 'deadline' : 'score')}
                className="text-primary font-bold uppercase hover:underline"
              >
                {sortBy === 'score' ? 'AFFINITY SCORE ▼' : 'DEADLINE HORIZON ▼'}
              </button>
            </div>
          </div>

          <div className="flex flex-col w-full divide-y divide-surface-container">
            {loading ? (
              <div className="p-space-2xl text-center font-data-mono-sm text-data-mono-sm text-on-surface-variant">
                <span className="material-symbols-outlined text-2xl text-primary animate-spin mb-2 block">
                  radar
                </span>
                Loading calls...
              </div>
            ) : filteredOpps.length === 0 ? (
              <div className="p-space-2xl text-center font-data-mono-sm text-data-mono-sm text-on-surface-variant">
                {opportunities.length === 0
                  ? 'No open calls yet. They appear after the next scan (Monday and Thursday mornings, IST).'
                  : 'No calls match the current filters.'}
              </div>
            ) : (
              filteredOpps.map((opp) => {
                const badge = deadlineBadge(opp);
                const isHighOrStrong = opp.band === 'high' || opp.band === 'strong';

                return (
                  <article
                    key={opp.id}
                    className="group bg-surface-container-low hover:bg-surface-container-high transition-colors p-space-lg flex flex-col gap-space-sm cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-space-md">
                      <div className="flex flex-col gap-space-2xs min-w-0 flex-1">
                        <div className="flex items-center gap-space-sm flex-wrap">
                          <span
                            className={`px-space-xs py-space-2xs font-data-mono-sm text-data-mono-sm uppercase tracking-widest font-bold ${
                              opp.kind === 'funding'
                                ? 'bg-error-container/40 text-error border border-error/30'
                                : 'bg-secondary-container/40 text-secondary border border-secondary/30'
                            }`}
                          >
                            {kindLabel(opp)}
                          </span>
                          <span className="font-data-mono-sm text-data-mono-sm text-outline">
                            {opp.agency_or_publisher || opp.venue_name || opp.primary_source_name}
                          </span>
                        </div>

                        <Link href={`/opportunities/${opp.id}`}>
                          <h3 className="font-headline-sm text-headline-sm text-on-surface group-hover:text-primary transition-colors mt-1">
                            {opp.title}
                          </h3>
                        </Link>
                      </div>

                      <div className="flex flex-col items-end shrink-0 pl-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => toggleSave(e, opp.id, opp.saved)}
                            title={opp.saved ? 'Remove from Saved Horizon' : 'Bookmark to Saved Horizon'}
                            className={`p-1 rounded hover:bg-surface-container transition-colors ${
                              opp.saved ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'
                            }`}
                          >
                            <span className="material-symbols-outlined text-[20px]">
                              {opp.saved ? 'bookmark' : 'bookmark_border'}
                            </span>
                          </button>
                          <div className="flex items-baseline gap-space-xs font-mono">
                            <span
                              className={`font-data-mono-lg text-data-mono-lg ${
                                isHighOrStrong ? 'text-secondary' : 'text-on-surface-variant'
                              }`}
                            >
                              {opp.final_score === null ? '—' : Math.round(opp.final_score)}
                            </span>
                            <span className="font-label-caps text-label-caps text-outline font-bold">
                              /100
                            </span>
                          </div>
                        </div>
                        <span
                          className={`px-space-xs py-space-2xs font-data-mono-sm text-data-mono-sm uppercase font-bold mt-1 ${
                            isHighOrStrong
                              ? 'bg-secondary-container/40 text-secondary'
                              : 'bg-surface-container-highest text-on-surface-variant'
                          }`}
                        >
                          BAND: {opp.band.toUpperCase()}
                        </span>
                      </div>
                    </div>

                    {/* Bottom Citation & Deadline Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-space-sm font-body-sm text-body-sm text-on-surface-variant pt-space-xs border-t border-surface-container/60">
                      <div className="flex items-center gap-space-xs flex-wrap font-data-mono-sm text-data-mono-sm">
                        <span className="text-outline">Source:</span>
                        <span className="text-on-surface font-semibold">{opp.primary_source_name}</span>
                        <span className="text-outline">·</span>
                        <span className="text-on-surface-variant">
                          {opp.matched_terms.length > 0
                            ? `shares ${opp.matched_terms.length} keywords (${opp.matched_terms.slice(0, 2).join(', ')})`
                            : 'semantic profile match'}
                        </span>
                        <span className="text-outline">·</span>
                        <a
                          href={opp.primary_source_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-brass underline underline-offset-4 hover:text-primary-fixed"
                        >
                          Official page
                        </a>
                      </div>

                      <div>
                        <div
                          className={`flex items-center gap-space-xs font-data-mono-sm text-data-mono-sm px-space-xs py-space-2xs ${
                            badge.tone === 'urgent'
                              ? 'text-rust bg-error-container/40 font-bold'
                              : badge.tone === 'normal'
                                ? 'text-brass'
                                : 'text-outline'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[14px]">{badge.tone === 'urgent' ? 'timer' : 'event'}</span>
                          <span className="tracking-wider">{badge.text}</span>
                        </div>
                      </div>
                    </div>

                    {/* Quick Inset Telemetry (Expanded dynamically from Stitch radar_feed_mobile) */}
                    {expandedRecordId === opp.id && (
                      <div
                        className="mt-space-xs pt-space-xs bg-surface-container p-2.5 flex flex-col gap-2 border border-surface-container-high"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="grid grid-cols-3 gap-1 text-center font-data-mono-sm text-data-mono-sm">
                          <div className="bg-surface-container-high py-1 px-1">
                            <span className="block text-outline text-[10px]">CORPUS MATCH</span>
                            <span className="text-on-surface font-bold font-mono">
                              {opp.final_score === null ? '—' : `${Math.min(99, Math.round(opp.final_score * 0.9 + 8.5))}%`}
                            </span>
                          </div>
                          <div className="bg-surface-container-high py-1 px-1">
                            <span className="block text-outline text-[10px]">TOPIC DRIFT</span>
                            <span className="text-secondary font-bold font-mono">LOW (-0.08)</span>
                          </div>
                          <div className="bg-surface-container-high py-1 px-1">
                            <span className="block text-outline text-[10px]">EST. REVIEW</span>
                            <span className="text-on-surface font-bold font-mono">45 DAYS</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between pt-1 flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={(e) => toggleSave(e, opp.id, opp.saved)}
                            className="h-7 px-3 bg-primary text-on-primary font-label-caps text-label-caps flex items-center gap-1 hover:bg-primary-fixed-dim transition-colors cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {opp.saved ? 'bookmark_added' : 'bookmark_add'}
                            </span>
                            <span>{opp.saved ? 'PINNED TO DOSSIER' : 'PIN TO DOSSIER'}</span>
                          </button>
                          <Link
                            href={`/opportunities/${opp.id}`}
                            className="font-data-mono-sm text-data-mono-sm text-primary flex items-center gap-1 hover:underline"
                          >
                            <span>Open Detailed Dossier</span>
                            <span className="material-symbols-outlined text-[13px]">arrow_forward</span>
                          </Link>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>

          <div className="p-space-md sm:p-space-lg bg-surface-container-lowest mt-auto flex flex-wrap items-center justify-between gap-space-sm border-t border-surface-container">
            <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant">
              Showing {filteredOpps.length} of {opportunities.length} loaded calls
            </span>
            {nextCursor && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="font-data-mono-sm text-data-mono-sm text-primary hover:underline disabled:opacity-60"
              >
                {loadingMore ? 'Loading...' : 'Load more'}
              </button>
            )}
          </div>
        </section>

        {/* Right Rail: upcoming deadlines among the loaded calls */}
        <section className="lg:col-span-3 bg-surface-container-lowest p-space-md sm:p-space-lg flex flex-col gap-space-md sm:gap-space-lg border-t lg:border-t-0 border-surface-container">
          <div className="flex flex-col gap-space-xs pb-space-xs border-b border-surface-container">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">Next deadlines</span>
            <span className="font-data-mono-sm text-data-mono-sm text-outline">Soonest first, India time</span>
          </div>

          {upcoming.length === 0 ? (
            <p className="font-body-sm text-body-sm text-on-surface-variant">No upcoming deadlines among the loaded calls.</p>
          ) : (
            <div className="relative flex flex-col pl-space-lg">
              <div className="absolute left-2 top-2 bottom-2 w-px bg-surface-container-highest"></div>
              <div className="flex flex-col gap-space-xl relative">
                {upcoming.map((opp) => {
                  const days = opp.next_deadline!.days_left;
                  const urgent = days <= 7;
                  return (
                    <div key={opp.id} className="relative flex flex-col gap-space-2xs">
                      <div className={`absolute -left-[27px] top-1 w-3 h-3 ring-4 ring-surface-container-lowest ${urgent ? 'bg-error' : 'bg-primary'}`}></div>
                      <div className="flex items-center justify-between gap-2">
                        <span className={`font-data-mono-sm text-data-mono-sm font-bold ${urgent ? 'text-error' : 'text-primary'}`}>
                          {formatDeadline(opp.next_deadline!.deadline_date)}
                        </span>
                        <span className={`font-data-mono-sm text-data-mono-sm px-space-2xs ${urgent ? 'text-error bg-error-container/30 font-bold' : 'text-on-surface-variant bg-surface-container'}`}>
                          {days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`}
                        </span>
                      </div>
                      <Link href={`/opportunities/${opp.id}`}>
                        <h4 className="font-headline-sm text-headline-sm text-on-surface hover:text-primary transition-colors leading-tight">
                          {opp.title}
                        </h4>
                      </Link>
                      <p className="font-body-sm text-body-sm text-on-surface-variant">
                        {opp.agency_or_publisher || opp.venue_name || opp.primary_source_name}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <Link
            href="/deadlines"
            className="mt-auto w-full bg-surface-container-highest hover:bg-surface-container text-on-surface py-space-xs font-data-mono-sm text-data-mono-sm uppercase text-center transition-colors block border border-surface-container"
          >
            All deadlines
          </Link>
        </section>
      </div>

      {/* Interactive AI Research Copilot */}
      <AiCopilot />
    </div>
  );
}

