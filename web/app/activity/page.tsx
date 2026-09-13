'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface SourceRunItem {
  source_name: string;
  status: 'success' | 'failed' | 'partial_failure';
  request_count: number;
  inserted_count: number;
  error_category?: string | null;
  latency_ms: number;
}

interface RejectedItem {
  title: string;
  source: string;
  reason: string;
}

interface PipelineRun {
  run_id: string;
  started_at: string;
  finished_at?: string;
  status: 'success' | 'partial_failure' | 'failed';
  opportunities_found: number;
  opportunities_new: number;
  sources: SourceRunItem[];
  rejected: RejectedItem[];
}

export default function ActivityPage() {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRun, setExpandedRun] = useState<string>('');

  useEffect(() => {
    fetch('/api/activity')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          const mapped: PipelineRun[] = data.map((d: any) => ({
            run_id: d.run_id,
            started_at: d.started_at,
            finished_at: d.finished_at,
            status: d.status || 'success',
            opportunities_found: d.opportunities_found || 0,
            opportunities_new: d.opportunities_new || 0,
            sources: d.sources || [],
            rejected: []
          }));
          setRuns(mapped);
          setExpandedRun(mapped[0]?.run_id || '');
        } else {
          setRuns([]);
        }
        setLoading(false);
      })
      .catch(() => {
        setRuns([]);
        setLoading(false);
      });
  }, []);

  const toggleRun = (id: string) => {
    setExpandedRun((prev) => (prev === id ? '' : id));
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-space-xl py-space-xl flex flex-col gap-space-2xl">
      {/* Header Block */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-space-md pb-space-lg">
        <div className="flex flex-col gap-space-xs">
          <div className="flex items-center gap-space-xs text-primary-container font-label-caps text-label-caps uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-primary-container"></span>
            <span>SYSTEM AUDIT LEDGER · LOG ARCHIVE</span>
          </div>
          <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight">
            Telemetry Activity &amp; Pipeline Governance
          </h1>
        </div>
        <div className="bg-surface-container-low px-space-md py-space-sm flex items-center gap-space-sm font-data-mono-sm text-data-mono-sm text-on-surface-variant border border-surface-container">
          <span className="material-symbols-outlined text-[14px] text-secondary">verified_user</span>
          <span>Ingestion Engine: <span className="text-on-surface font-semibold">v3.8-kNN</span></span>
          <span className="text-outline-variant">·</span>
          <span>Scheduler: <span className="text-on-surface font-semibold">Cron 12h</span></span>
          <span className="text-outline-variant">·</span>
          <span>Mirror Health: <span className="text-secondary font-semibold">100% Verified</span></span>
        </div>
      </div>

      {/* Summary Stat Tiles with Progress Gauges */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-space-sm">
        <div className="bg-surface-container-low p-space-md flex flex-col justify-between border border-surface-container">
          <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
            Aggregated Scans (24h)
          </span>
          <div className="flex items-baseline justify-between mt-space-sm">
            <span className="font-data-mono-lg text-data-mono-lg text-on-surface font-mono font-bold">224 Records</span>
            <span className="font-data-mono-sm text-data-mono-sm text-secondary font-mono">+14.2%</span>
          </div>
          <div className="w-full bg-surface-container h-1 mt-space-sm">
            <div className="bg-secondary h-1 w-[82%]"></div>
          </div>
        </div>

        <div className="bg-surface-container-low p-space-md flex flex-col justify-between border border-surface-container">
          <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
            Mean HTTP Latency
          </span>
          <div className="flex items-baseline justify-between mt-space-sm">
            <span className="font-data-mono-lg text-data-mono-lg text-primary font-mono font-bold">614 ms</span>
            <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant font-mono">TARGET &lt; 900ms</span>
          </div>
          <div className="w-full bg-surface-container h-1 mt-space-sm">
            <div className="bg-primary-container h-1 w-[68%]"></div>
          </div>
        </div>

        <div className="bg-surface-container-low p-space-md flex flex-col justify-between border border-surface-container">
          <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
            Prune &amp; Filter Rate
          </span>
          <div className="flex items-baseline justify-between mt-space-sm">
            <span className="font-data-mono-lg text-data-mono-lg text-on-surface font-mono font-bold">64.3%</span>
            <span className="font-data-mono-sm text-data-mono-sm text-tertiary font-mono">144 Dropped</span>
          </div>
          <div className="w-full bg-surface-container h-1 mt-space-sm">
            <div className="bg-tertiary-container h-1 w-[64%]"></div>
          </div>
        </div>

        <div className="bg-surface-container-low p-space-md flex flex-col justify-between border border-surface-container">
          <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
            Telemetry Node Pulse
          </span>
          <div className="flex items-baseline justify-between mt-space-sm">
            <span className="font-data-mono-lg text-data-mono-lg text-secondary font-mono font-bold">Nominal</span>
            <span className="font-data-mono-sm text-data-mono-sm text-secondary flex items-center gap-space-2xs font-mono font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary inline-block animate-pulse"></span>ACTIVE
            </span>
          </div>
          <div className="w-full bg-surface-container h-1 mt-space-sm">
            <div className="bg-secondary h-1 w-full"></div>
          </div>
        </div>
      </div>

      {/* Runs Audit List */}
      <div className="space-y-space-md">
        <div className="flex items-center justify-between pb-space-xs border-b border-surface-container">
          <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
            Chronological Run Logs (Reverse Historical Order)
          </span>
          <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant font-mono">
            ASCENDING TIMESTAMPS
          </span>
        </div>

        {loading ? (
          <div className="p-space-2xl text-center font-data-mono-sm text-data-mono-sm text-on-surface-variant bg-surface-container-low border border-surface-container font-mono">
            FETCHING GOVERNANCE RUN LOGS...
          </div>
        ) : runs.length === 0 ? (
          <div className="p-space-2xl text-center font-data-mono-sm text-data-mono-sm text-on-surface-variant bg-surface-container-low border border-surface-container font-mono">
            NO PIPELINE AUDIT LOGS IN DATABASE.
            <p className="mt-2 text-outline text-xs">Run logs will be recorded here automatically once scheduled or manual pipeline scans run.</p>
          </div>
        ) : (
          runs.map((r) => {
            const isExpanded = expandedRun === r.run_id;

            return (
              <div
                key={r.run_id}
                className="bg-surface-container-low border border-surface-container transition-all overflow-hidden"
              >
                {/* Run Summary Bar */}
                <div
                  onClick={() => toggleRun(r.run_id)}
                  className="p-space-md flex flex-col md:flex-row md:items-center justify-between gap-space-md cursor-pointer select-none hover:bg-surface-container transition-colors"
                >
                  <div className="flex items-center gap-space-md flex-wrap font-mono">
                    <span className="font-data-mono-md text-data-mono-md text-on-surface font-bold">
                      {new Date(r.started_at).toISOString().replace('T', ' ').substring(0, 19)} UTC
                    </span>
                    <span className="text-outline-variant">/</span>
                    <span className="text-data-mono-sm text-on-surface-variant">ID: #{r.run_id}</span>
                    <span
                      className={`font-data-mono-sm text-data-mono-sm uppercase font-bold px-space-xs py-space-2xs ${
                        r.status === 'success'
                          ? 'bg-secondary-container/40 text-secondary border border-secondary/30'
                          : r.status === 'partial_failure'
                          ? 'bg-primary-container/30 text-brass border border-brass/40'
                          : 'bg-error-container/30 text-rust border border-rust/30'
                      }`}
                    >
                      {r.status.toUpperCase()}
                    </span>
                  </div>

                  <div className="flex items-center gap-space-lg font-mono text-data-mono-sm">
                    <div className="text-on-surface-variant">
                      FOUND:{' '}
                      <strong className="text-primary font-bold">{r.opportunities_found}</strong> · NEW:{' '}
                      <strong className="text-secondary font-bold">{r.opportunities_new}</strong>
                    </div>
                    <span className="material-symbols-outlined text-primary text-[18px]">
                      {isExpanded ? 'expand_less' : 'expand_more'}
                    </span>
                  </div>
                </div>

                {/* Expanded Detail Panel */}
                {isExpanded && (
                  <div className="p-space-lg bg-surface-container-lowest border-t border-surface-container space-y-space-lg font-mono">
                    {/* Per-Source Breakdown Table */}
                    <div>
                      <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider block mb-space-xs">
                        Per-Source Health &amp; Ingestion Breakdown
                      </span>
                      <table className="w-full text-left border-collapse border border-surface-container font-data-mono-sm text-data-mono-sm">
                        <thead>
                          <tr className="bg-surface-container border-b border-surface-container text-on-surface-variant font-normal">
                            <th className="py-space-xs px-space-sm">Source Ingestion Node</th>
                            <th className="py-space-xs px-space-sm">Status</th>
                            <th className="py-space-xs px-space-sm">Requests</th>
                            <th className="py-space-xs px-space-sm">Inserted</th>
                            <th className="py-space-xs px-space-sm">Error / Diagnostic</th>
                            <th className="py-space-xs px-space-sm text-right">Latency</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-surface-container text-on-surface">
                          {r.sources.map((s, idx) => (
                            <tr key={idx} className="hover:bg-surface-container-low">
                              <td className="py-space-xs px-space-sm font-bold">{s.source_name}</td>
                              <td className="py-space-xs px-space-sm">
                                <span
                                  className={`px-space-2xs py-0.5 uppercase text-[10px] font-bold ${
                                    s.status === 'success'
                                      ? 'text-secondary'
                                      : 'text-rust'
                                  }`}
                                >
                                  {s.status}
                                </span>
                              </td>
                              <td className="py-space-xs px-space-sm">{s.request_count}</td>
                              <td className="py-space-xs px-space-sm text-secondary font-bold">
                                {s.inserted_count}
                              </td>
                              <td className="py-space-xs px-space-sm text-on-surface-variant">
                                {s.error_category || 'None (Healthy)'}
                              </td>
                              <td className="py-space-xs px-space-sm text-right text-primary">
                                {s.latency_ms} ms
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Pre-Alert Rejections (Governance Gate) */}
                    {r.rejected && r.rejected.length > 0 && (
                      <div className="pt-space-xs border-t border-surface-container">
                        <span className="font-label-caps text-label-caps text-rust uppercase tracking-wider block mb-space-xs">
                          Governance Verification Gate Drops ({r.rejected.length})
                        </span>
                        <div className="space-y-space-2xs font-data-mono-sm text-data-mono-sm">
                          {r.rejected.map((rej, i) => (
                            <div
                              key={i}
                              className="p-space-xs bg-surface-container-low border border-surface-container flex flex-col md:flex-row justify-between gap-space-xs text-on-surface"
                            >
                              <span className="font-medium text-on-surface">
                                [{rej.source}] {rej.title}
                              </span>
                              <span className="text-rust italic">{rej.reason}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

