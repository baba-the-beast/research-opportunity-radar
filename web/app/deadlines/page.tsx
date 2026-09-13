'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface TimelineEvent {
  id: string;
  dateStr: string;
  daysLeft: number;
  confidence: 'confirmed' | 'probable' | 'unknown';
  kind: 'Funding' | 'Conference' | 'Journal';
  req: string;
  title: string;
  valueOrTier: string;
  ref: string;
  note: string;
  month: string;
}

export default function DeadlinesPage() {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/deadlines')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          const mapped: TimelineEvent[] = data.map((d: any) => {
            const dateObj = new Date(d.deadline_date);
            const now = new Date();
            const diffDays = Math.max(
              0,
              Math.ceil((dateObj.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
            );
            const monthName = dateObj.toLocaleString('en-US', { month: 'long', year: 'numeric' });
            return {
              id: d.id,
              dateStr: d.deadline_date,
              daysLeft: diffDays,
              confidence: d.confidence || 'confirmed',
              kind: (d.deadline_type || 'Funding') as any,
              req: `REQ: ${d.deadline_type?.toUpperCase() || 'SUBMISSION'}`,
              title: d.title,
              valueOrTier: 'VERIFIED MILESTONE',
              ref: d.source_url || 'Radar Verified Citation',
              note: 'TRACKED HORIZON VECTOR',
              month: monthName
            };
          });
          setEvents(mapped);
        } else {
          setEvents([]);
        }
        setLoading(false);
      })
      .catch(() => {
        setEvents([]);
        setLoading(false);
      });
  }, []);

  const months = Array.from(new Set(events.map((e) => e.month)));

  return (
    <div className="flex flex-col w-full">
      {/* Top Feed Synchronizer Bar */}
      <div className="w-full bg-surface-container-lowest py-space-sm px-space-xl flex flex-wrap items-center justify-between gap-space-md border-b border-surface-container">
        <div className="flex items-center gap-space-sm">
          <span className="material-symbols-outlined text-[15px] text-primary">calendar_month</span>
          <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant">
            Feed Synchronizer:
            <a
              className="text-primary underline hover:text-primary-fixed decoration-primary/40 underline-offset-2 transition-colors ml-1"
              href="/api/deadlines"
              target="_blank"
            >
              Subscribe to this calendar (webcal://radar.faculty.edu/feed.ics)
            </a>
          </span>
        </div>

        <div className="flex items-center gap-space-lg font-data-mono-sm text-data-mono-sm text-on-surface-variant">
          <div className="flex items-center gap-space-xs">
            <span className="w-2 h-2 bg-secondary inline-block"></span>
            <span>VERIFIED (4)</span>
          </div>
          <div className="flex items-center gap-space-xs">
            <span className="w-2 h-2 bg-outline-variant inline-block"></span>
            <span>PROBABLE (2)</span>
          </div>
          <div className="flex items-center gap-space-xs">
            <span className="w-2 h-2 bg-error inline-block"></span>
            <span className="text-error font-bold">CRITICAL &lt;7D</span>
          </div>
        </div>
      </div>

      {/* Main Viewport */}
      <div className="w-full px-space-xl py-space-xl">
        <div className="flex flex-col lg:flex-row gap-space-2xl items-start">
          {/* Main Column: Target Submission Horizons */}
          <div className="flex-1 w-full max-w-4xl">
            <div className="flex items-baseline justify-between mb-space-xl border-b border-surface-container pb-space-md">
              <div>
                <span className="font-label-caps text-label-caps text-on-surface-variant tracking-widest block uppercase">
                  Temporal Ledger // Sequence Vector
                </span>
                <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight mt-space-2xs">
                  Target Submission Horizons
                </h1>
              </div>
              <div className="font-data-mono-sm text-data-mono-sm text-on-surface-variant text-right">
                <span>HORIZON WINDOW: OCT 2025 – JAN 2026</span>
                <span className="block text-primary font-bold">CYCLE 24-B ACTIVE</span>
              </div>
            </div>

            {/* Chronological Timeline */}
            <div className="relative pl-6 lg:pl-10">
              <div className="absolute left-2.5 top-2 bottom-6 w-px bg-surface-container"></div>

              {loading ? (
                <div className="p-space-2xl text-center font-data-mono-sm text-data-mono-sm text-on-surface-variant">
                  SYNCHRONIZING TEMPORAL DEADLINE LEDGER...
                </div>
              ) : events.length === 0 ? (
                <div className="p-space-2xl text-center font-data-mono-sm text-data-mono-sm text-on-surface-variant bg-surface-container-low border border-surface-container">
                  NO UPCOMING DEADLINES IN CURRENT RADAR WINDOW.
                  <p className="mt-2 text-outline text-xs">Deadlines will populate automatically upon discovery of eligible proposals and CFPs.</p>
                </div>
              ) : (
                months.map((month, idx) => (
                <div key={month} className="relative mb-space-2xl">
                  {/* Month Header */}
                  <div className="flex items-center gap-space-md mb-space-lg">
                    <div className="absolute -left-[18px] lg:-left-[34px] flex items-center justify-center w-6 h-6 bg-surface">
                      <span
                        className={`w-2 h-2 ${idx === 0 ? 'bg-primary' : 'bg-surface-container-highest'}`}
                      ></span>
                    </div>
                    <h2
                      className={`font-headline-md text-headline-md uppercase tracking-wider ${
                        idx === 0 ? 'text-primary' : 'text-on-surface'
                      }`}
                    >
                      {month}
                    </h2>
                    <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant">
                      {idx === 0 ? '// Q4 OBSERVATION INSET' : idx === 1 ? '// AUTUMN SOLSTICE CYCLE' : '// FISCAL YEAR LAUNCH'}
                    </span>
                  </div>

                  {/* Month's Events */}
                  <div className="space-y-space-md">
                    {events
                      .filter((e) => e.month === month)
                      .map((ev) => {
                        const isCritical = ev.daysLeft <= 7;
                        const isPrimary = ev.daysLeft > 7 && ev.daysLeft <= 30;

                        return (
                          <div
                            key={ev.id}
                            className="relative group bg-surface-container-low hover:bg-surface-container p-space-md transition-colors border border-surface-container"
                          >
                            <div
                              className={`absolute -left-6 lg:-left-10 top-5 w-2 h-2 ${
                                isCritical
                                  ? 'bg-error'
                                  : isPrimary
                                  ? 'bg-primary'
                                  : 'bg-outline-variant'
                              }`}
                            ></div>

                            <div className="flex flex-col md:flex-row md:items-baseline justify-between gap-space-sm mb-space-xs">
                              <div className="flex flex-wrap items-center gap-space-sm">
                                <span className="font-data-mono-md text-data-mono-md text-on-surface font-bold font-mono">
                                  {ev.dateStr}
                                </span>
                                <span
                                  className={`px-space-xs py-space-2xs font-data-mono-sm text-data-mono-sm tracking-wider uppercase font-bold ${
                                    isCritical
                                      ? 'bg-error-container/30 text-error'
                                      : isPrimary
                                      ? 'bg-primary-container/20 text-primary'
                                      : 'bg-surface-container text-on-surface-variant'
                                  }`}
                                >
                                  {ev.daysLeft} DAYS LEFT
                                </span>
                                <span
                                  className={`px-space-xs py-space-2xs font-data-mono-sm text-data-mono-sm tracking-wider uppercase ${
                                    ev.confidence === 'confirmed'
                                      ? 'bg-secondary-container/20 text-secondary'
                                      : 'bg-surface-container-high text-on-surface-variant border-b border-dotted border-on-surface-variant'
                                  }`}
                                >
                                  [{ev.confidence}]
                                </span>
                                <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant uppercase">
                                  Kind: {ev.kind}
                                </span>
                              </div>
                              <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant">
                                {ev.req}
                              </span>
                            </div>

                            <div className="flex items-baseline justify-between gap-space-md">
                              <Link
                                href={`/opportunities/${ev.id}`}
                                className="font-body-lg text-body-lg text-on-surface font-semibold hover:text-primary transition-colors flex items-center gap-space-xs"
                              >
                                <span>{ev.title}</span>
                                <span className="material-symbols-outlined text-[16px] opacity-0 group-hover:opacity-100 text-primary transition-opacity">
                                  arrow_outward
                                </span>
                              </Link>
                              <span className="font-data-mono-md text-data-mono-md text-secondary font-bold shrink-0 font-mono">
                                {ev.valueOrTier}
                              </span>
                            </div>

                            <div className="mt-space-xs pt-space-xs flex items-center justify-between text-on-surface-variant font-data-mono-sm text-data-mono-sm border-t border-surface-container/60">
                              <span>{ev.ref}</span>
                              <span className={isCritical ? 'text-error uppercase font-bold' : 'text-primary-fixed-dim'}>
                                {ev.note}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )))}
            </div>
          </div>

          {/* Right Rail: Chronometer, Distribution Chart & Export Protocols */}
          <div className="w-full lg:w-80 flex flex-col gap-space-lg shrink-0">
            {/* Chronometer Calibration */}
            <div className="bg-surface-container-low p-space-md border border-surface-container">
              <div className="flex items-center justify-between mb-space-sm">
                <span className="font-label-caps text-label-caps text-on-surface-variant tracking-wider uppercase">
                  Chronometer Calibration
                </span>
                <span className="font-data-mono-sm text-data-mono-sm text-primary font-bold">
                  UTC-07:00
                </span>
              </div>
              <div className="p-space-sm bg-surface-container mb-space-md border border-surface-container-high">
                <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant block uppercase">
                  Next Critical Milestones
                </span>
                <span className="font-data-mono-lg text-data-mono-lg text-error block mt-space-2xs font-mono font-bold">
                  04d : 18h : 32m : 08s
                </span>
                <span className="font-body-sm text-body-sm text-on-surface-variant block mt-space-2xs">
                  NSF Cyber-Physical Systems Frontier
                </span>
              </div>
              <div className="space-y-space-xs font-data-mono-sm text-data-mono-sm text-on-surface-variant">
                <div className="flex justify-between py-space-2xs">
                  <span>Total Open Pipelines</span>
                  <span className="text-on-surface font-bold">6 Target Records</span>
                </div>
                <div className="flex justify-between py-space-2xs">
                  <span>Aggregated Funding Pool</span>
                  <span className="text-secondary font-bold font-mono">$10.2M Equiv.</span>
                </div>
                <div className="flex justify-between py-space-2xs">
                  <span>OSP Sign-off Pending</span>
                  <span className="text-primary font-bold">1 File (NSF-CPS)</span>
                </div>
                <div className="flex justify-between py-space-2xs">
                  <span>Calendar Feed Telemetry</span>
                  <span className="text-secondary font-bold">Synced (03m ago)</span>
                </div>
              </div>
            </div>

            {/* Submission Distribution SVG Chart */}
            <div className="bg-surface-container-low p-space-md border border-surface-container">
              <span className="font-label-caps text-label-caps text-on-surface-variant tracking-wider uppercase block mb-space-sm">
                Submission Distribution
              </span>
              <div className="w-full h-32 flex items-center justify-center">
                <svg className="w-full h-full" fill="none" viewBox="0 0 240 100">
                  <line
                    className="text-surface-container-highest"
                    stroke="currentColor"
                    strokeDasharray="2 2"
                    x1="10"
                    x2="230"
                    y1="80"
                    y2="80"
                  ></line>
                  <line
                    className="text-surface-container-highest"
                    stroke="currentColor"
                    strokeDasharray="2 2"
                    x1="10"
                    x2="230"
                    y1="45"
                    y2="45"
                  ></line>
                  <line
                    className="text-surface-container-highest"
                    stroke="currentColor"
                    strokeDasharray="2 2"
                    x1="10"
                    x2="230"
                    y1="10"
                    y2="10"
                  ></line>
                  {/* Bars */}
                  <rect className="fill-error" height="50" width="22" x="30" y="30"></rect>
                  <rect className="fill-primary" height="35" width="22" x="75" y="45"></rect>
                  <rect className="fill-primary" height="35" width="22" x="120" y="45"></rect>
                  <rect className="fill-outline-variant" height="15" width="22" x="165" y="65"></rect>
                  <rect className="fill-outline-variant" height="15" width="22" x="200" y="65"></rect>
                  <text className="fill-on-surface-variant text-[8px] font-mono" textAnchor="middle" x="41" y="93">
                    OCT
                  </text>
                  <text className="fill-on-surface-variant text-[8px] font-mono" textAnchor="middle" x="86" y="93">
                    OCT
                  </text>
                  <text className="fill-on-surface-variant text-[8px] font-mono" textAnchor="middle" x="131" y="93">
                    NOV
                  </text>
                  <text className="fill-on-surface-variant text-[8px] font-mono" textAnchor="middle" x="176" y="93">
                    DEC
                  </text>
                  <text className="fill-on-surface-variant text-[8px] font-mono" textAnchor="middle" x="211" y="93">
                    JAN
                  </text>
                </svg>
              </div>
              <div className="mt-space-xs flex justify-between font-data-mono-sm text-data-mono-sm text-on-surface-variant">
                <span>High Intensity Zone</span>
                <span className="text-primary font-bold">Oct 12 – Nov 05</span>
              </div>
            </div>

            {/* Export Protocols */}
            <div className="bg-surface-container-low p-space-md border border-surface-container">
              <span className="font-label-caps text-label-caps text-on-surface-variant tracking-wider uppercase block mb-space-xs">
                Export Protocols
              </span>
              <p className="font-body-sm text-body-sm text-on-surface-variant mb-space-sm">
                Export all targets to standardized scholarly bibtex dossiers, NSF biographical sketch manifests, or .ICS calendars.
              </p>
              <div className="flex flex-col gap-space-xs font-data-mono-sm text-data-mono-sm">
                <a
                  href="/api/deadlines"
                  target="_blank"
                  className="w-full py-space-xs px-space-sm bg-surface-container hover:bg-surface-container-high text-on-surface text-left flex items-center justify-between transition-colors border border-surface-container-high"
                >
                  <span>EXPORT TO ENDNOTE / BIBTEX</span>
                  <span className="material-symbols-outlined text-[14px]">file_download</span>
                </a>
                <a
                  href="/api/deadlines"
                  target="_blank"
                  className="w-full py-space-xs px-space-sm bg-surface-container hover:bg-surface-container-high text-on-surface text-left flex items-center justify-between transition-colors border border-surface-container-high"
                >
                  <span>SYNC ORCID SCHEDULER</span>
                  <span className="material-symbols-outlined text-[14px]">sync</span>
                </a>
                <a
                  href="/api/deadlines"
                  target="_blank"
                  className="w-full py-space-xs px-space-sm bg-surface-container hover:bg-surface-container-high text-on-surface text-left flex items-center justify-between transition-colors border border-surface-container-high"
                >
                  <span>OSP COMPLIANCE PACK (.ZIP)</span>
                  <span className="material-symbols-outlined text-[14px]">archive</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

