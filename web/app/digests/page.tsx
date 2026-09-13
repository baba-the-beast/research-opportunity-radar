'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface DigestCycle {
  id: string;
  cycleNumber: number;
  dates: string;
  status: 'Active Window' | 'Archived';
  summary: string;
  topMatchTitle: string;
  topMatchScore: number;
  executiveSummary: string;
  signals: {
    number: string;
    kind: string;
    badge: string;
    badgeClass: string;
    title: string;
    desc: string;
    metricLabel: string;
    metricValue: string;
    affinityScore: number;
    timeline: string;
    timelineClass?: string;
  }[];
  actions: {
    title: string;
    desc: string;
    icon: string;
  }[];
  labReadiness: {
    budget: string;
    letters: string;
    postdoc: string;
  };
}

export default function DigestsPage() {
  const [cycles, setCycles] = useState<DigestCycle[]>([]);
  const [openCycle, setOpenCycle] = useState<string>('');
  const [liveDigest, setLiveDigest] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/digest/latest')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.markdown) {
          setLiveDigest(data);
        }
      })
      .catch(() => {});
  }, []);

  const toggleCycle = (id: string) => {
    setOpenCycle((prev) => (prev === id ? '' : id));
  };

  const copyMarkdown = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col w-full">
      <div className="w-full px-space-xl py-space-xl flex flex-col gap-space-xl">
        {/* Header Block */}
        <div className="flex flex-col md:flex-row md:items-end justify-between pb-space-lg gap-space-md border-b border-surface-container">
          <div className="flex flex-col gap-space-xs max-w-2xl">
            <div className="flex items-center gap-space-sm">
              <span className="font-label-caps text-label-caps text-primary uppercase">
                ARCHIVAL SYNTHESIS // DISPATCH FEED
              </span>
              <span className="text-on-surface-variant font-data-mono-sm text-data-mono-sm">·</span>
              <span className="font-data-mono-sm text-data-mono-sm text-secondary font-bold">
                TELEMETRY RIG-9
              </span>
            </div>
            <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight">
              Weekly Intelligence Digests
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant">
              Automated synthesis reports delivered every Monday at 06:00 UTC based on telemetry filters and faculty research vectors.
            </p>
          </div>

          <div className="flex items-center gap-space-md bg-surface-container px-space-md py-space-sm rounded border border-surface-container-high">
            <div className="flex items-center gap-space-xs font-data-mono-sm text-data-mono-sm text-on-surface-variant">
              <span>TOTAL ARCHIVED:</span>
              <span className="text-primary font-bold">24 WEEKS</span>
            </div>
            <span className="text-outline-variant font-data-mono-sm text-data-mono-sm">/</span>
            <div className="flex items-center gap-space-xs font-data-mono-sm text-data-mono-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary inline-block"></span>
              <span className="text-secondary font-bold">INGESTION MIRROR ACTIVE</span>
            </div>
          </div>
        </div>

        {/* 4 Metric Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-space-md">
          <div className="bg-surface-container p-space-md flex flex-col gap-space-2xs border border-surface-container-high">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
              Aggregated Signals
            </span>
            <div className="flex items-baseline justify-between mt-space-xs font-mono">
              <span className="font-data-mono-lg text-data-mono-lg text-primary font-bold">142</span>
              <span className="font-data-mono-sm text-data-mono-sm text-secondary font-bold">
                +12 this cycle
              </span>
            </div>
          </div>

          <div className="bg-surface-container p-space-md flex flex-col gap-space-2xs border border-surface-container-high">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
              Mean Affinity Score
            </span>
            <div className="flex items-baseline justify-between mt-space-xs font-mono">
              <span className="font-data-mono-lg text-data-mono-lg text-on-surface font-bold">78.4</span>
              <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant">
                SIGMA 4.2
              </span>
            </div>
          </div>

          <div className="bg-surface-container p-space-md flex flex-col gap-space-2xs border border-surface-container-high">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
              Critical Windows
            </span>
            <div className="flex items-baseline justify-between mt-space-xs font-mono">
              <span className="font-data-mono-lg text-data-mono-lg text-rust font-bold">
                03 SOLICITATIONS
              </span>
              <span className="font-data-mono-sm text-data-mono-sm text-rust font-bold">&lt; 7 DAYS</span>
            </div>
          </div>

          <div className="bg-surface-container p-space-md flex flex-col gap-space-2xs border border-surface-container-high">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
              Archival Format
            </span>
            <div className="flex items-baseline justify-between mt-space-xs font-mono">
              <span className="font-data-mono-lg text-data-mono-lg text-secondary font-bold">
                MD // BIBTEX
              </span>
              <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant">
                RFC-822
              </span>
            </div>
          </div>
        </div>

        {/* Live Digest Callout if Available */}
        {liveDigest && (
          <div className="bg-surface-container-low border border-primary/40 p-space-lg flex flex-col gap-space-sm">
            <div className="flex items-center justify-between">
              <span className="font-label-caps text-label-caps text-primary uppercase font-bold">
                Live Orchestrator Latest Run Output
              </span>
              <button
                onClick={() => copyMarkdown(liveDigest.markdown)}
                className="font-data-mono-sm text-data-mono-sm text-brass underline hover:text-primary-fixed"
              >
                {copied ? 'Copied!' : 'Copy Live Markdown'}
              </button>
            </div>
            <pre className="font-mono text-xs text-on-surface whitespace-pre-wrap leading-relaxed bg-surface-container-lowest p-space-md border border-surface-container max-h-60 overflow-y-auto">
              {liveDigest.markdown}
            </pre>
          </div>
        )}

        {/* Observatory Chronology Log (Accordion) */}
        <div className="flex flex-col gap-space-md">
          <div className="flex items-center justify-between px-space-sm border-b border-surface-container pb-2">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
              Observatory Chronology Log
            </span>
            <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant">
              INTERVAL: T-24 CYCLES
            </span>
          </div>

          <div className="flex flex-col gap-space-md" id="digest-accordion-group">
            {cycles.length === 0 ? (
              <div className="p-space-2xl text-center font-data-mono-sm text-data-mono-sm text-on-surface-variant bg-surface-container-low border border-surface-container rounded">
                NO ARCHIVED DIGEST CYCLES RECORDED IN SUPABASE LEDGER.
                <p className="mt-2 text-outline text-xs">Run a pipeline cycle or trigger a scan to archive executive summaries.</p>
              </div>
            ) : (
              cycles.map((cycle) => {
              const isOpen = openCycle === cycle.id;

              return (
                <div
                  key={cycle.id}
                  className="bg-surface-container rounded transition-all duration-200 border border-surface-container-high overflow-hidden"
                >
                  {/* Accordion Row Header */}
                  <div
                    onClick={() => toggleCycle(cycle.id)}
                    className="p-space-lg flex flex-col md:flex-row md:items-center justify-between gap-space-md cursor-pointer select-none bg-surface-container hover:bg-surface-container-high transition-colors"
                  >
                    <div className="flex flex-col gap-space-2xs">
                      <div className="flex items-center gap-space-sm flex-wrap">
                        <span className="font-data-mono-md text-data-mono-md font-bold text-primary tracking-wider font-mono">
                          {cycle.dates} // CYCLE {cycle.cycleNumber}
                        </span>
                        <span
                          className={`font-data-mono-sm text-data-mono-sm px-space-xs py-space-2xs uppercase ${
                            cycle.status === 'Active Window'
                              ? 'bg-secondary-container/40 text-secondary font-bold'
                              : 'bg-surface-container-high text-on-surface-variant'
                          }`}
                        >
                          {cycle.status}
                        </span>
                      </div>
                      <p className="font-body-sm text-body-sm text-on-surface-variant mt-space-2xs">
                        {cycle.summary} (
                        <span className="font-data-mono-sm text-data-mono-sm text-primary font-bold font-mono">
                          {cycle.topMatchScore}
                        </span>
                        )
                      </p>
                    </div>

                    <div className="flex items-center gap-space-lg self-end md:self-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copyMarkdown(cycle.executiveSummary);
                        }}
                        className="font-data-mono-sm text-data-mono-sm text-brass underline hover:text-primary-fixed tracking-wider uppercase font-bold"
                      >
                        Export Markdown / BibTeX
                      </button>
                      <span className="material-symbols-outlined text-primary text-[20px] transition-transform duration-200">
                        {isOpen ? 'expand_less' : 'expand_more'}
                      </span>
                    </div>
                  </div>

                  {/* Accordion Content Body */}
                  {isOpen && (
                    <div className="px-space-lg pb-space-xl pt-space-xs flex flex-col gap-space-xl bg-surface-container-lowest border-t border-surface-container">
                      {/* Executive Summary */}
                      <div className="flex flex-col gap-space-md pt-space-md">
                        <div className="flex items-center justify-between">
                          <h2 className="font-headline-lg text-headline-lg text-on-surface">
                            Executive Summary &amp; High-Affinity Signals
                          </h2>
                          <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant font-mono">
                            GENERATED {cycle.dates.split('—')[0].trim()} 06:00:12 UTC
                          </span>
                        </div>
                        <p className="font-body-md text-body-md text-on-surface-variant max-w-4xl leading-relaxed">
                          {cycle.executiveSummary}
                        </p>
                      </div>

                      {/* Signal Cards */}
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-space-md">
                        {cycle.signals.map((sig, i) => (
                          <div
                            key={i}
                            className="bg-surface-container p-space-lg flex flex-col justify-between gap-space-md relative overflow-hidden border border-surface-container-high"
                          >
                            <div className="flex flex-col gap-space-sm">
                              <div className="flex items-center justify-between">
                                <span className="font-label-caps text-label-caps text-secondary uppercase tracking-widest">
                                  Signal {sig.number} // {sig.kind}
                                </span>
                                <span
                                  className={`font-data-mono-sm text-data-mono-sm px-space-xs py-space-2xs uppercase font-bold ${sig.badgeClass}`}
                                >
                                  {sig.badge}
                                </span>
                              </div>
                              <h3 className="font-headline-sm text-headline-sm text-on-surface">
                                {sig.title}
                              </h3>
                              <p className="font-body-sm text-body-sm text-on-surface-variant">
                                {sig.desc}
                              </p>
                            </div>

                            <div className="flex flex-col gap-space-xs pt-space-md bg-surface-container-low p-space-sm rounded border border-surface-container font-mono">
                              <div className="flex items-center justify-between font-data-mono-sm text-data-mono-sm">
                                <span className="text-on-surface-variant">AFFINITY SCORE</span>
                                <span className="text-primary font-bold">{sig.affinityScore} / 100</span>
                              </div>
                              <div className="flex items-center justify-between font-data-mono-sm text-data-mono-sm">
                                <span className="text-on-surface-variant">{sig.metricLabel}</span>
                                <span
                                  className={`font-bold uppercase ${
                                    sig.timelineClass || 'text-on-surface'
                                  }`}
                                >
                                  {sig.metricValue}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Action Items & Recommended Protocols */}
                      <div className="bg-surface-container p-space-lg rounded flex flex-col gap-space-md border border-surface-container-high">
                        <div className="flex items-center justify-between">
                          <h3 className="font-headline-md text-headline-md text-on-surface">
                            Action Items &amp; Recommended Protocols
                          </h3>
                          <span className="font-label-caps text-label-caps text-secondary uppercase tracking-widest">
                            FACULTY PROTOCOL: VIBHA-CORE
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-space-lg">
                          <div className="flex flex-col gap-space-sm">
                            {cycle.actions.map((act, i) => (
                              <div key={i} className="flex items-start gap-space-sm">
                                <span className="material-symbols-outlined text-primary text-[18px] mt-0.5">
                                  {act.icon}
                                </span>
                                <div className="flex flex-col gap-space-2xs">
                                  <span className="font-body-md text-body-md font-bold text-on-surface">
                                    {act.title}
                                  </span>
                                  <p className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed">
                                    {act.desc}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className="flex flex-col gap-space-sm bg-surface-container-low p-space-md rounded border border-surface-container">
                            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase font-bold">
                              Affiliated Laboratory Readiness
                            </span>
                            <div className="flex flex-col gap-space-xs mt-space-2xs font-mono">
                              <div className="flex items-center justify-between font-data-mono-sm text-data-mono-sm">
                                <span className="text-on-surface-variant">
                                  Budget &amp; Facilities Narrative:
                                </span>
                                <span className="text-secondary font-bold">
                                  {cycle.labReadiness.budget}
                                </span>
                              </div>
                              <div className="flex items-center justify-between font-data-mono-sm text-data-mono-sm">
                                <span className="text-on-surface-variant">
                                  Letters of Collaboration:
                                </span>
                                <span className="text-tertiary font-bold">
                                  {cycle.labReadiness.letters}
                                </span>
                              </div>
                              <div className="flex items-center justify-between font-data-mono-sm text-data-mono-sm">
                                <span className="text-on-surface-variant">
                                  Postdoc Resource Allocation:
                                </span>
                                <span className="text-on-surface font-bold">
                                  {cycle.labReadiness.postdoc}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-space-sm mt-space-sm pt-space-sm border-t border-surface-container">
                              <a
                                href="/api/deadlines"
                                target="_blank"
                                className="bg-primary text-on-primary font-data-mono-sm text-data-mono-sm px-space-md py-space-xs rounded font-bold uppercase hover:bg-primary-fixed transition-colors"
                              >
                                Export Full TeX Bundle
                              </a>
                              <button
                                onClick={() =>
                                  copyMarkdown(
                                    `# Research Opportunity Radar Digest — Cycle ${cycle.cycleNumber}\n\n${cycle.executiveSummary}`
                                  )
                                }
                                className="bg-transparent text-on-surface font-data-mono-sm text-data-mono-sm px-space-md py-space-xs rounded uppercase hover:bg-surface-container-highest transition-colors border border-surface-container"
                              >
                                Copy Raw Markdown
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            }))}
          </div>
        </div>

        {/* Terminal Endpoint Footer Bar */}
        <div className="bg-surface-container-low p-space-md flex flex-col sm:flex-row items-center justify-between gap-space-md rounded border border-surface-container">
          <div className="flex items-center gap-space-sm font-data-mono-sm text-data-mono-sm text-on-surface-variant font-mono">
            <span className="material-symbols-outlined text-[16px] text-primary">terminal</span>
            <span>INDEX ENDPOINT: ror://archive/digests/stream?cycles=39-43&amp;format=telem-md</span>
          </div>
          <button className="bg-surface-container hover:bg-surface-container-high text-on-surface font-data-mono-sm text-data-mono-sm px-space-md py-space-xs rounded uppercase transition-colors border border-surface-container-high">
            Load Previous 20 Cycles
          </button>
        </div>
      </div>
    </div>
  );
}

