'use client';

import { useEffect, useState } from 'react';
import { formatIstDateTime } from '@/lib/dates';
import type { SourceHealth } from '@/app/api/sources/health/route';
import { Badge, EmptyState, Icon, LoadingRows, Page, PageHeader, Panel, type Tone } from '@/components/ui';

interface SourceRunItem {
  source_name: string;
  status: 'success' | 'failed' | 'partial_failure';
  request_count: number;
  inserted_count: number;
  error_category?: string | null;
  latency_ms: number;
}

interface PipelineRun {
  run_id: string;
  started_at: string;
  finished_at?: string;
  status: 'success' | 'partial_failure' | 'failed' | 'running';
  opportunities_found: number;
  opportunities_new: number;
  sources: SourceRunItem[];
}

const RUN_STATUS: Record<string, { tone: Tone; text: string }> = {
  success: { tone: 'success', text: 'Completed' },
  partial_failure: { tone: 'warning', text: 'Some sources failed' },
  failed: { tone: 'danger', text: 'Failed' },
  running: { tone: 'info', text: 'Running' }
};

function duration(run: PipelineRun): string | null {
  if (!run.finished_at) return null;
  const ms = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.round(ms / 60000);
  return min < 1 ? 'under a minute' : `${min} min`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-4">
      <span className="text-body-sm text-on-surface-variant">{label}</span>
      <span className="text-[1.75rem] leading-8 font-semibold tracking-[-0.02em] text-on-surface tabular-nums">{value}</span>
      {hint && <span className="text-body-sm text-on-surface-variant">{hint}</span>}
    </div>
  );
}

export default function ActivityPage() {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [expandedRun, setExpandedRun] = useState<string>('');
  const [health, setHealth] = useState<SourceHealth[]>([]);

  useEffect(() => {
    fetch('/api/sources/health')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setHealth(Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : []))
      .catch(() => setHealth([]));
  }, []);

  useEffect(() => {
    fetch('/api/activity?scope=system')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const items = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
        const mapped: PipelineRun[] = items.map((d: any) => ({
          run_id: d.run_id,
          started_at: d.started_at,
          finished_at: d.finished_at,
          status: d.status || 'success',
          opportunities_found: d.opportunities_found || 0,
          opportunities_new: d.opportunities_new || 0,
          sources: d.sources || []
        }));
        setRuns(mapped);
        setExpandedRun(mapped[0]?.run_id || '');
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  const latest = runs[0];
  const sourcesOk = latest ? latest.sources.filter((s) => s.status === 'success').length : 0;
  const newLast10 = runs.slice(0, 10).reduce((n, r) => n + r.opportunities_new, 0);

  return (
    <Page>
      <PageHeader
        title="Scan activity"
        description="Each scan checks every source for new calls. Scans run on Monday and Thursday mornings (IST). Times below are IST."
      />

      {loading ? (
        <Panel>
          <LoadingRows rows={3} label="Loading scan activity" />
        </Panel>
      ) : failed ? (
        <Panel>
          <EmptyState icon="cloud_off" title="Scan activity did not load">
            Refresh the page to try again. If it keeps failing, the server may be offline.
          </EmptyState>
        </Panel>
      ) : runs.length === 0 ? (
        <Panel>
          <EmptyState icon="history" title="No scans yet">
            Each scan is recorded here once the first scheduled or manual scan runs.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 rounded-2xl surface-card bg-surface divide-x divide-y lg:divide-y-0 divide-outline-variant overflow-hidden">
            <Stat label="Last scan" value={latest.finished_at ? formatIstDateTime(latest.finished_at).replace(' IST', '').split(',')[0] : 'Running'} hint={RUN_STATUS[latest.status]?.text} />
            <Stat label="Calls checked" value={String(latest.opportunities_found)} hint="in the last scan" />
            <Stat label="New calls" value={String(newLast10)} hint={`across the last ${Math.min(10, runs.length)} scans`} />
            <Stat label="Sources reached" value={latest.sources.length ? `${sourcesOk}/${latest.sources.length}` : '—'} hint="in the last scan" />
          </div>

          {health.length > 0 && (
            <section className="flex flex-col gap-3" aria-labelledby="sources-heading">
              <div className="flex flex-col gap-1">
                <h2 id="sources-heading" className="font-headline-sm text-headline-sm text-on-surface">
                  Funding sources
                </h2>
                <p className="text-body-sm text-on-surface-variant">
                  What each funder&rsquo;s website showed on its last check: calls that are open or not yet closed.
                </p>
              </div>
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {health.map((s) => (
                  <li key={s.source_name} className="rounded-xl surface-card bg-surface px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex flex-col min-w-0">
                      <span className="text-body-md font-semibold text-on-surface truncate">{s.source_name}</span>
                      <span className="text-body-sm text-on-surface-variant">Checked {formatIstDateTime(s.checked_at).replace(' IST', '')}</span>
                    </div>
                    {s.ok ? (
                      <span className="text-body-sm text-on-surface-variant text-right shrink-0">
                        <strong className="text-on-surface tabular-nums">{s.kept_count}</strong> current
                      </span>
                    ) : (
                      <Badge tone="danger">Could not be read</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="flex flex-col gap-3" aria-labelledby="runs-heading">
            <h2 id="runs-heading" className="font-headline-sm text-headline-sm text-on-surface">
              Recent scans
            </h2>
            <ul className="rounded-2xl surface-card bg-surface divide-y divide-outline-variant overflow-hidden">
              {runs.map((r) => {
                const open = expandedRun === r.run_id;
                const status = RUN_STATUS[r.status] ?? RUN_STATUS.success;
                const took = duration(r);
                return (
                  <li key={r.run_id}>
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={`run-${r.run_id}`}
                      onClick={() => setExpandedRun(open ? '' : r.run_id)}
                      className="w-full text-left px-5 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3 hover:bg-surface-container-low transition-colors"
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-body-md font-semibold text-on-surface">{formatIstDateTime(r.started_at)}</span>
                        <Badge tone={status.tone}>{status.text}</Badge>
                      </div>
                      <div className="flex items-center gap-4 text-body-sm text-on-surface-variant">
                        <span>
                          <strong className="text-on-surface tabular-nums">{r.opportunities_found}</strong> checked
                        </span>
                        <span>
                          <strong className="text-on-surface tabular-nums">{r.opportunities_new}</strong> new
                        </span>
                        {took && <span className="hidden sm:inline">{took}</span>}
                        <Icon name={open ? 'expand_less' : 'expand_more'} />
                      </div>
                    </button>

                    {open && (
                      <div id={`run-${r.run_id}`} className="px-5 sm:px-6 pb-5">
                        {r.sources.length === 0 ? (
                          <p className="text-body-sm text-on-surface-variant">No per-source details were recorded for this scan.</p>
                        ) : (
                          <div className="overflow-x-auto rounded-xl border border-outline-variant">
                            <table className="w-full min-w-[560px] text-left text-body-sm">
                              <caption className="sr-only">Sources checked in the scan of {formatIstDateTime(r.started_at)}</caption>
                              <thead className="bg-surface-container-low text-on-surface-variant">
                                <tr>
                                  <th scope="col" className="px-4 py-2.5 font-semibold">Source</th>
                                  <th scope="col" className="px-4 py-2.5 font-semibold">Result</th>
                                  <th scope="col" className="px-4 py-2.5 font-semibold text-right">Requests</th>
                                  <th scope="col" className="px-4 py-2.5 font-semibold text-right">Calls added</th>
                                  <th scope="col" className="px-4 py-2.5 font-semibold text-right">Time</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-outline-variant text-on-surface">
                                {r.sources.map((s, idx) => (
                                  <tr key={idx}>
                                    <th scope="row" className="px-4 py-2.5 font-semibold">{s.source_name}</th>
                                    <td className="px-4 py-2.5">
                                      {s.status === 'success' ? (
                                        <span className="text-secondary">Reached</span>
                                      ) : (
                                        <span className="text-error">{s.error_category ? `Failed: ${s.error_category.replace(/_/g, ' ')}` : 'Failed'}</span>
                                      )}
                                    </td>
                                    <td className="px-4 py-2.5 text-right tabular-nums">{s.request_count}</td>
                                    <td className="px-4 py-2.5 text-right tabular-nums">{s.inserted_count}</td>
                                    <td className="px-4 py-2.5 text-right text-on-surface-variant">
                                      {s.latency_ms >= 1000 ? `${(s.latency_ms / 1000).toFixed(1)} s` : `${s.latency_ms} ms`}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </Page>
  );
}
