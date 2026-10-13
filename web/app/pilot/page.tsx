'use client';

import { useEffect, useState } from 'react';
import { EmptyState, LoadingRows, Page, PageHeader, Panel } from '@/components/ui';

interface PilotMetrics {
  days: number;
  scope: 'all' | 'institution';
  faculty_profiles: number;
  active_users: number;
  applications_started: number;
  applications_submitted: number;
  funded: number;
  not_funded: number;
  median_notice_days: number | null;
  preparing_past_deadline: number;
  reminders_sent: number;
  new_calls_found: number;
}

const WINDOWS = [30, 60, 90];

function Tile({ label, value, hint, lead = false }: { label: string; value: string; hint: string; lead?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 rounded-xl surface-card bg-surface px-5 py-4 ${lead ? 'sm:col-span-2' : ''}`}>
      <span className="text-body-sm text-on-surface-variant">{label}</span>
      <span className={`${lead ? 'text-[2.75rem] leading-[3rem]' : 'text-[1.75rem] leading-8'} font-semibold tracking-[-0.02em] text-on-surface tabular-nums`}>
        {value}
      </span>
      <span className="text-body-sm text-on-surface-variant">{hint}</span>
    </div>
  );
}

/** Is the app helping people apply? For a pilot with a research office, or for operators. */
export default function PilotPage() {
  const [days, setDays] = useState(60);
  const [data, setData] = useState<PilotMetrics | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError('');
    fetch(`/api/pilot/metrics?days=${days}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
        setData(body?.data ?? body);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <Page>
      <PageHeader
        title="Pilot results"
        description={
          data?.scope === 'institution'
            ? 'How faculty at your institution are using the radar. Counts only; no names.'
            : 'How researchers are using the radar. Counts only; no names.'
        }
      />

      <div role="radiogroup" aria-label="Period" className="flex gap-2">
        {WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            role="radio"
            aria-checked={days === w}
            onClick={() => setDays(w)}
            className={`min-h-11 sm:min-h-9 px-4 rounded-lg text-body-sm font-semibold transition-colors ${
              days === w ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface hover:bg-surface-container-high'
            }`}
          >
            Last {w} days
          </button>
        ))}
      </div>

      {loading ? (
        <Panel>
          <LoadingRows rows={3} label="Loading pilot results" />
        </Panel>
      ) : error ? (
        <Panel>
          <EmptyState icon="lock" title="Pilot results are not available">
            {error}
          </EmptyState>
        </Panel>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile
              lead
              label="Applications started"
              value={String(data.applications_started)}
              hint={`Calls marked "I'm applying" in the last ${data.days} days. The number to watch.`}
            />
            <Tile label="Submitted" value={String(data.applications_submitted)} hint="Marked as submitted" />
            <Tile label="Funded" value={String(data.funded)} hint={`${data.not_funded} not funded`} />
            <Tile
              label="Notice before deadline"
              value={data.median_notice_days === null ? '—' : `${Math.round(data.median_notice_days)} days`}
              hint="Median, when an application was started"
            />
            <Tile label="Still preparing, deadline passed" value={String(data.preparing_past_deadline)} hint="Possible missed deadlines" />
            <Tile label="Reminders sent" value={String(data.reminders_sent)} hint="Deadline reminders by Telegram or email" />
            <Tile label="Faculty on the radar" value={String(data.faculty_profiles)} hint={`${data.active_users} active in this period`} />
            <Tile label="New calls found" value={String(data.new_calls_found)} hint="Across all scans in this period" />
          </div>
          <Panel title="Reading these numbers">
            <ul className="list-disc pl-5 text-body-sm text-on-surface-variant space-y-1.5 max-w-[70ch]">
              <li>The pilot works if people start applications for calls they would not have found otherwise. Ask a few of them which ones.</li>
              <li>Long notice (several weeks) means calls are reaching people early enough to write a proposal.</li>
              <li>“Still preparing, deadline passed” can also mean someone applied and did not mark it; check before counting it as missed.</li>
            </ul>
          </Panel>
        </>
      ) : null}
    </Page>
  );
}
