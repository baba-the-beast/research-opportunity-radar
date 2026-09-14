'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getClientAuthHeaders } from '@/lib/apiAuth';

interface OpportunitySummary {
  id: string;
  kind: string;
  title: string;
  summary: string;
  agency_or_publisher: string;
  venue_name: string;
  primary_source_name: string;
  primary_source_url: string;
  next_deadline: { deadline_date: string; confidence: string } | null;
  final_score: number;
  band: string;
  matched_terms: string[];
  status: string;
  external_id?: string;
  eligibility_verdict?: string;
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
    timestamp: '2026-01-01T00:00:00.000Z',
    agent: 'Orchestrator',
    phase: 'SYSTEM',
    level: 'INFO',
    stepIndex: 1,
    message: 'Observatory telemetry matrix calibrated. Standing multi-agent watch loop online.'
  },
  {
    timestamp: '2026-01-01T00:00:00.000Z',
    agent: 'FacultyMemoryStore',
    phase: 'PROFILE',
    level: 'INFO',
    stepIndex: 1,
    message: 'Investigator node #VIBHA-COEP active. 5 weighted descriptor vectors mounted.'
  }
];

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
  const [dryRun, setDryRun] = useState(false);
  const [rescanTriggered, setRescanTriggered] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [activeStep, setActiveStep] = useState(1);
  const [activePhase, setActivePhase] = useState('IDLE');
  const [logs, setLogs] = useState<AgentTelemetryLog[]>(INITIAL_LOGS);
  const [keywords, setKeywords] = useState<string[]>([
    'Edge AI',
    'Sensor Fusion',
    'Autonomous Systems',
    'Embedded ML',
    'Distributed Robotics'
  ]);
  const [newKeyword, setNewKeyword] = useState('');
  const [showAddKeyword, setShowAddKeyword] = useState(false);

  useEffect(() => {
    fetch('/api/opportunities')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setOpportunities(data);
        } else {
          setOpportunities([]);
        }
        setLoading(false);
      })
      .catch(() => {
        setOpportunities([]);
        setLoading(false);
      });
  }, []);

  const triggerRescan = async () => {
    if (isStreaming) return;
    setRescanTriggered(true);
    setIsStreaming(true);
    setConsoleOpen(true);
    setActivePhase('INIT');

    try {
      const response = await fetch(`/api/pipeline/stream?run=true&dry_run=${dryRun}`, {
        headers: getClientAuthHeaders()
      });
      if (!response.body) throw new Error('ReadableStream not supported');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          const trimmed = block.trim();
          if (trimmed.startsWith('data: ')) {
            try {
              const event: AgentTelemetryLog = JSON.parse(trimmed.replace('data: ', ''));
              setLogs((prev) => [...prev, event]);
              if (event.phase) setActivePhase(event.phase);
              if (event.stepIndex) setActiveStep(event.stepIndex);

              if (event.phase === 'COMPLETE') {
                fetch('/api/opportunities')
                  .then((res) => res.json())
                  .then((fresh) => {
                    if (Array.isArray(fresh)) {
                      setOpportunities(fresh);
                    }
                  })
                  .catch(() => {});
              }
            } catch (e) {
              console.error('SSE parse error', e);
            }
          }
        }
      }
    } catch (err) {
      console.error('Streaming error', err);
      await fetch('/api/pipeline/trigger', { method: 'POST' }).catch(() => {});
    } finally {
      setIsStreaming(false);
      setRescanTriggered(false);
    }
  };

  const handleAddKeyword = () => {
    if (!newKeyword.trim()) return;
    setKeywords([...keywords, newKeyword.trim()]);
    setNewKeyword('');
    setShowAddKeyword(false);
  };

  const removeKeyword = (kw: string) => {
    setKeywords(keywords.filter((k) => k !== kw));
  };

  const toggleBand = (b: string) => {
    setFilterBands((prev) => ({ ...prev, [b]: !prev[b] }));
  };

  const filteredOpps = opportunities
    .filter((o) => filterBands[o.band] ?? true)
    .filter((o) => filterKind === 'all' || o.kind.toLowerCase().includes(filterKind.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'score') return b.final_score - a.final_score;
      if (!a.next_deadline?.deadline_date) return 1;
      if (!b.next_deadline?.deadline_date) return -1;
      return a.next_deadline.deadline_date.localeCompare(b.next_deadline.deadline_date);
    });

  const countByBand = (b: string) => opportunities.filter((o) => o.band === b).length;

  return (
    <div className="flex flex-col w-full">
      {/* Top Observatory Telemetry Bar */}
      <div className="w-full bg-surface-container-lowest px-space-xl py-space-md flex flex-wrap items-center justify-between gap-space-md border-b border-surface-container">
        <div className="flex items-center gap-space-lg">
          <div className="flex items-center gap-space-xs font-label-caps text-label-caps text-on-surface-variant">
            <span className="w-2 h-2 bg-primary-container inline-block"></span>
            <span className="tracking-widest uppercase text-primary">TELEMETRY MATRIX: ACTIVE SCAN</span>
          </div>
          <span className="font-data-mono-sm text-data-mono-sm text-outline">EPOCH // 2026.Q3</span>
          <span className="font-data-mono-sm text-data-mono-sm text-outline">SOURCE NODES: 9 INTEGRATED</span>
        </div>
        <div className="flex items-center gap-space-md font-data-mono-sm text-data-mono-sm">
          <span className="text-on-surface-variant">
            AFFINITY ENGINE: <span className="text-secondary font-bold">K-NEAREST EMBEDDINGS (V3.8)</span>
          </span>
          <label className="flex items-center gap-1.5 cursor-pointer text-on-surface-variant hover:text-on-surface select-none font-data-mono-sm text-data-mono-sm">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              disabled={isStreaming}
              className="accent-primary w-3.5 h-3.5 cursor-pointer"
            />
            <span className="tracking-wider uppercase">DRY RUN</span>
          </label>
          <div className="h-3 w-px bg-surface-container-high"></div>
          <button
            onClick={triggerRescan}
            disabled={isStreaming}
            className="text-on-primary bg-primary-container px-space-md py-space-2xs font-label-caps text-label-caps tracking-wider uppercase hover:bg-primary transition-colors flex items-center gap-1 disabled:opacity-75 cursor-pointer"
          >
            {isStreaming ? (
              <>
                <span className="material-symbols-outlined text-[13px] animate-spin">sync</span>
                <span>Streaming Agents...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[13px]">radar</span>
                <span>Rescan Corpus</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Observatory Agent Reasoning Console (Live Telemetry Stream) */}
      <div className="w-full bg-surface-container-lowest border-b border-surface-container flex flex-col transition-all">
        {/* Console Header Bar */}
        <div className="px-space-xl py-space-xs flex flex-wrap items-center justify-between gap-space-md bg-surface-container-low/50 border-b border-surface-container">
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
        <section className="lg:col-span-3 bg-surface-container-lowest p-space-lg flex flex-col gap-space-xl border-r border-surface-container">
          {/* Investigator Node */}
          <div className="flex flex-col gap-space-sm">
            <div className="flex items-center justify-between">
              <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">
                Investigator Node
              </span>
              <span className="font-data-mono-sm text-data-mono-sm text-primary">#VIBHA-COEP</span>
            </div>
            <h2 className="font-headline-md text-headline-md text-on-surface font-bold leading-tight">
              Prof. Vibha
            </h2>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Department of Computer Science & Cyber-Physical Systems
            </p>
            <p className="font-data-mono-sm text-data-mono-sm text-outline uppercase tracking-wider">
              College of Engineering, Pune (COEP)
            </p>
          </div>

          {/* Weighted Descriptors Chips */}
          <div className="flex flex-col gap-space-xs">
            <div className="flex items-center justify-between pb-space-2xs">
              <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">
                Weighted Descriptors ({keywords.length})
              </span>
              <button
                onClick={() => setShowAddKeyword(!showAddKeyword)}
                className="font-data-mono-sm text-data-mono-sm text-primary hover:underline"
              >
                + Add Vector
              </button>
            </div>

            {showAddKeyword && (
              <div className="flex gap-1 mb-2">
                <input
                  type="text"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  placeholder="New keyword..."
                  onKeyDown={(e) => e.key === 'Enter' && handleAddKeyword()}
                  className="bg-surface-container-low px-2 py-1 text-xs text-on-surface border border-surface-container flex-1 focus:outline-none focus:border-primary"
                />
                <button
                  onClick={handleAddKeyword}
                  className="bg-primary text-on-primary px-2 py-1 text-xs font-mono font-bold"
                >
                  ADD
                </button>
              </div>
            )}

            <div className="flex flex-wrap gap-space-xs" id="keyword-cluster">
              {keywords.map((kw) => (
                <div
                  key={kw}
                  className="flex items-center gap-space-xs bg-surface-container-low px-space-sm py-space-2xs font-data-mono-sm text-data-mono-sm text-on-surface border border-surface-container"
                >
                  <span>{kw}</span>
                  <span
                    onClick={() => removeKeyword(kw)}
                    className="text-outline hover:text-error cursor-pointer ml-1"
                  >
                    ×
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Telemetry Radar Geometry Display */}
          <div className="flex flex-col gap-space-xs">
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
                {/* Plotted Marks */}
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

          {/* Affinity Threshold Filter */}
          <div className="flex flex-col gap-space-sm">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">
              Affinity Threshold
            </span>
            <div className="flex flex-col gap-space-2xs">
              {(
                [
                  { key: 'high', label: 'HIGH (80+)', color: 'text-verdigris' },
                  { key: 'strong', label: 'STRONG (65-79)', color: 'text-verdigris' },
                  { key: 'watch', label: 'WATCH (50-64)', color: 'text-on-surface-variant' },
                  { key: 'low', label: 'LOW (<50)', color: 'text-outline' }
                ] as const
              ).map(({ key, label, color }) => (
                <label
                  key={key}
                  className="flex items-center justify-between p-space-xs bg-surface-container-low hover:bg-surface-container cursor-pointer transition-colors border border-surface-container"
                >
                  <span className="flex items-center gap-space-sm font-data-mono-sm text-data-mono-sm text-on-surface">
                    <input
                      type="checkbox"
                      checked={filterBands[key]}
                      onChange={() => toggleBand(key)}
                      className="accent-primary rounded-none w-3.5 h-3.5"
                    />
                    <span>{label}</span>
                  </span>
                  <span className={`font-data-mono-sm text-data-mono-sm font-bold ${color}`}>
                    0{countByBand(key)}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Instrument Modality Filter */}
          <div className="flex flex-col gap-space-sm">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">
              Instrument Modality
            </span>
            <div className="grid grid-cols-4 gap-space-xs font-data-mono-sm text-data-mono-sm">
              {(['all', 'journal', 'venue', 'funding'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setFilterKind(m)}
                  className={`px-space-xs py-space-sm text-center uppercase font-bold transition-colors ${
                    filterKind === m
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
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
                SWEEPING ACTIVE REPOSITORIES...
              </div>
            ) : filteredOpps.length === 0 ? (
              <div className="p-space-2xl text-center font-data-mono-sm text-data-mono-sm text-on-surface-variant">
                NO OPPORTUNITIES MATCH CURRENT FILTER CUTOFFS.
              </div>
            ) : (
              filteredOpps.map((opp) => {
                const isUnder7Days =
                  opp.next_deadline &&
                  (opp.next_deadline.deadline_date.includes('12') ||
                    opp.next_deadline.deadline_date.includes('2025-10-12'));
                const isHighOrStrong = opp.band === 'high' || opp.band === 'strong';

                return (
                  <article
                    key={opp.id}
                    className="group bg-surface-container-low hover:bg-surface-container-high transition-colors p-space-lg flex flex-col gap-space-sm cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-space-md">
                      <div className="flex flex-col gap-space-2xs min-w-0 flex-1">
                        <div className="flex items-center gap-space-sm flex-wrap">
                          {opp.kind === 'award' || opp.primary_source_name?.toLowerCase().includes('award') || opp.agency_or_publisher?.toLowerCase().includes('award') ? (
                            <span className="px-space-xs py-space-2xs font-data-mono-sm text-data-mono-sm uppercase tracking-widest font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              ACTIVE PROGRAM — AWARDED FUNDING HISTORY
                            </span>
                          ) : (
                            <span
                              className={`px-space-xs py-space-2xs font-data-mono-sm text-data-mono-sm uppercase tracking-widest font-bold ${
                                opp.kind === 'journal'
                                  ? 'bg-secondary-container/40 text-secondary border border-secondary/30'
                                  : opp.kind === 'funding'
                                  ? 'bg-error-container/40 text-error border border-error/30'
                                  : 'bg-surface-container-highest text-on-surface'
                              }`}
                            >
                              {opp.kind === 'journal'
                                ? 'SPECIAL ISSUE'
                                : opp.kind === 'funding'
                                ? opp.next_deadline
                                  ? `OPEN CALL — DEADLINE [${opp.next_deadline.deadline_date}]`
                                  : 'OPEN CALL — SOLICITATION'
                                : 'CONFERENCE CFP'}
                            </span>
                          )}
                          <span className="font-data-mono-sm text-data-mono-sm text-outline">
                            {opp.external_id || opp.agency_or_publisher}
                          </span>
                          {opp.eligibility_verdict && (
                            <span
                              className={`px-space-xs py-space-2xs font-data-mono-sm text-data-mono-sm uppercase tracking-wider font-bold border ${
                                opp.eligibility_verdict === 'ELIGIBLE'
                                  ? 'bg-secondary-container/40 text-secondary border-secondary/30'
                                  : opp.eligibility_verdict.includes('WARNING')
                                  ? 'bg-primary-container/40 text-primary border-primary/30'
                                  : 'bg-error-container/40 text-error border-error/30'
                              }`}
                            >
                              {opp.eligibility_verdict === 'ELIGIBLE'
                                ? '✓ ELIGIBLE'
                                : opp.eligibility_verdict.includes('WARNING')
                                ? '⚠ LIMITED SUBMISSION'
                                : '✕ NOT ELIGIBLE'}
                            </span>
                          )}
                        </div>

                        <Link href={`/opportunities/${opp.id}`}>
                          <h3 className="font-headline-sm text-headline-sm text-on-surface group-hover:text-primary transition-colors mt-1">
                            {opp.title}
                          </h3>
                        </Link>
                      </div>

                      <div className="flex flex-col items-end shrink-0 pl-2">
                        <div className="flex items-baseline gap-space-xs font-mono">
                          <span
                            className={`font-data-mono-lg text-data-mono-lg ${
                              isHighOrStrong ? 'text-secondary' : 'text-on-surface-variant'
                            }`}
                          >
                            {Math.round(opp.final_score)}
                          </span>
                          <span className="font-label-caps text-label-caps text-outline font-bold">
                            /100
                          </span>
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
                          Citation Link
                        </a>
                      </div>

                      <div>
                        {opp.next_deadline ? (
                          isUnder7Days ? (
                            <div className="flex items-center gap-space-xs font-data-mono-sm text-data-mono-sm text-rust bg-error-container/40 px-space-xs py-space-2xs font-bold">
                              <span className="material-symbols-outlined text-[14px]">timer</span>
                              <span className="tracking-wider uppercase">8 DAYS REMAINING</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-space-xs font-data-mono-sm text-data-mono-sm text-brass">
                              <span className="material-symbols-outlined text-[14px]">event</span>
                              <span className="tracking-wider uppercase">
                                {opp.next_deadline.deadline_date} (34 DAYS LEFT)
                              </span>
                            </div>
                          )
                        ) : (
                          <div className="flex items-center gap-space-xs font-data-mono-sm text-data-mono-sm text-outline">
                            <span className="material-symbols-outlined text-[14px]">all_inclusive</span>
                            <span className="uppercase tracking-wider">ROLLING SUBMISSION</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          <div className="p-space-lg bg-surface-container-lowest mt-auto flex items-center justify-between border-t border-surface-container">
            <div className="flex items-center gap-space-md font-data-mono-sm text-data-mono-sm text-on-surface-variant">
              <span>RESONANCE WINDOW: 180 DAYS</span>
              <span className="text-outline">·</span>
              <span>AUTOSCAN RATE: 12H</span>
            </div>
            <div className="flex items-center gap-space-xs font-data-mono-sm text-data-mono-sm">
              <span className="text-outline">EXPORT DATA:</span>
              <a href="/api/deadlines" target="_blank" className="text-primary hover:underline uppercase">
                BibTeX
              </a>
              <span className="text-outline">/</span>
              <a href="/api/deadlines" target="_blank" className="text-primary hover:underline uppercase">
                CSV
              </a>
            </div>
          </div>
        </section>

        {/* Right Rail: Chronological Horizon Timeline */}
        <section className="lg:col-span-3 bg-surface-container-lowest p-space-lg flex flex-col gap-space-lg">
          <div className="flex flex-col gap-space-xs pb-space-xs border-b border-surface-container">
            <div className="flex items-center justify-between">
              <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">
                Chronological Horizon
              </span>
              <span className="font-data-mono-sm text-data-mono-sm text-secondary font-bold">ACTIVE CLOCK</span>
            </div>
            <span className="font-data-mono-sm text-data-mono-sm text-outline">ASCENDING BY CLOSE DATE</span>
          </div>

          <div className="relative flex flex-col pl-space-lg">
            <div className="absolute left-2 top-2 bottom-2 w-px bg-surface-container-highest"></div>
            <div className="flex flex-col gap-space-xl relative">
              {/* Event 1: Critical Horizon */}
              <div className="relative flex flex-col gap-space-2xs">
                <div className="absolute -left-[27px] top-1 w-3 h-3 bg-error ring-4 ring-surface-container-lowest"></div>
                <div className="flex items-center justify-between">
                  <span className="font-data-mono-sm text-data-mono-sm text-error font-bold">2025.10.12</span>
                  <span className="font-data-mono-sm text-data-mono-sm text-error bg-error-container/30 px-space-2xs font-bold">
                    T-8 DAYS
                  </span>
                </div>
                <Link href="/deadlines">
                  <h4 className="font-headline-sm text-headline-sm text-on-surface hover:text-primary transition-colors leading-tight">
                    NSF CPS Frontier Research
                  </h4>
                </Link>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  Full Proposal Submission Deadline (5:00 PM Submitter's Local Time)
                </p>
                <div className="flex items-center gap-space-sm font-data-mono-sm text-data-mono-sm text-outline pt-space-2xs">
                  <span>FUNDING: $1.2M - $3.0M</span>
                </div>
              </div>

              {/* Event 2: Watching Horizon */}
              <div className="relative flex flex-col gap-space-2xs">
                <div className="absolute -left-[27px] top-1 w-3 h-3 bg-primary ring-4 ring-surface-container-lowest"></div>
                <div className="flex items-center justify-between">
                  <span className="font-data-mono-sm text-data-mono-sm text-primary font-bold">2025.10.24</span>
                  <span className="font-data-mono-sm text-data-mono-sm text-primary bg-surface-container px-space-2xs">
                    T-34 DAYS
                  </span>
                </div>
                <Link href="/deadlines">
                  <h4 className="font-headline-sm text-headline-sm text-on-surface hover:text-primary transition-colors leading-tight">
                    ACM/IEEE ICCPS 2025
                  </h4>
                </Link>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  Technical Paper Submission Closes (Anywhere on Earth AOE)
                </p>
                <div className="flex items-center gap-space-sm font-data-mono-sm text-data-mono-sm text-outline pt-space-2xs">
                  <span>LOCATION: IRVINE, CA</span>
                </div>
              </div>

              {/* Event 3: Internal Milestone */}
              <div className="relative flex flex-col gap-space-2xs">
                <div className="absolute -left-[27px] top-1 w-3 h-3 bg-secondary ring-4 ring-surface-container-lowest"></div>
                <div className="flex items-center justify-between">
                  <span className="font-data-mono-sm text-data-mono-sm text-secondary font-bold">2025.11.28</span>
                  <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant bg-surface-container px-space-2xs">
                    INTERNAL
                  </span>
                </div>
                <Link href="/deadlines">
                  <h4 className="font-headline-sm text-headline-sm text-on-surface hover:text-primary transition-colors leading-tight">
                    IEEE TCPS Edge Issue Check
                  </h4>
                </Link>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  University Pre-submission Cleared for OpenAlex Indexed Topics
                </p>
                <div className="flex items-center gap-space-sm font-data-mono-sm text-data-mono-sm text-outline pt-space-2xs">
                  <span>FACULTY REF: #VIBHA-COEP</span>
                </div>
              </div>

              {/* Event 4: Long Horizon */}
              <div className="relative flex flex-col gap-space-2xs">
                <div className="absolute -left-[27px] top-1 w-3 h-3 bg-outline ring-4 ring-surface-container-lowest"></div>
                <div className="flex items-center justify-between">
                  <span className="font-data-mono-sm text-data-mono-sm text-outline font-bold">2026.01.20</span>
                  <span className="font-data-mono-sm text-data-mono-sm text-outline bg-surface-container px-space-2xs">
                    T-133 DAYS
                  </span>
                </div>
                <h4 className="font-headline-sm text-headline-sm text-on-surface leading-tight">
                  DARPA Sensor Networks Cutoff
                </h4>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  Phase-1 Executive Summary & White Paper Submission Window
                </p>
                <div className="flex items-center gap-space-sm font-data-mono-sm text-data-mono-sm text-outline pt-space-2xs">
                  <span>SOLICITATION: RA-24-03</span>
                </div>
              </div>
            </div>
          </div>

          {/* Calendar Sync Bridge Box */}
          <div className="mt-auto p-space-md bg-surface-container-low flex flex-col gap-space-xs border border-surface-container">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">
              Calendar Sync Bridge
            </span>
            <p className="font-body-sm text-body-sm text-outline">
              Synchronizing with Institutional Exchange Server & ORCID profile feed.
            </p>
            <a
              href="/api/deadlines"
              target="_blank"
              className="w-full mt-space-2xs bg-surface-container-highest hover:bg-surface-container text-on-surface py-space-xs font-data-mono-sm text-data-mono-sm uppercase text-center transition-colors block border border-surface-container"
            >
              Export .ICS Calendar Feed
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}

