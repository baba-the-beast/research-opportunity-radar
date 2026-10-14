'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Icon, Panel } from '@/components/ui';
import { NOTES_MAX, STAGE, stageStep, type ApplicationStatus, type TrackStatus } from '@/lib/applications';
import { MY_DEADLINE_LABEL_MAX } from '@/lib/reminders';
import { daysUntil, formatDeadline, relativeDays } from '@/lib/dates';

const STEPS = ['Preparing', 'Submitted', 'Outcome'] as const;

type PersonalFields = { notes?: string; my_deadline?: string | null; my_deadline_label?: string };

/**
 * Tracks one application: where it is (Preparing -> Submitted -> Outcome), the next action, and
 * private notes that save as you type.
 *
 * Saved values are reported through onSaved so the page can pass them back in if the panel
 * remounts (e.g. after Stop tracking, then I'm applying again) instead of the values it first loaded.
 */
export function ApplicationPanel({
  opportunityId,
  status,
  initialNotes,
  initialMyDeadline,
  initialMyDeadlineLabel,
  onStatusChange,
  onSaved,
  busy
}: {
  opportunityId: string;
  status: ApplicationStatus;
  initialNotes: string;
  initialMyDeadline: string | null;
  initialMyDeadlineLabel: string;
  onStatusChange: (next: TrackStatus) => void;
  onSaved?: (fields: PersonalFields) => void;
  busy?: boolean;
}) {
  const step = stageStep(status);
  const [notes, setNotes] = useState(initialNotes);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const lastSaved = useRef(initialNotes);
  const pending = useRef<string | null>(null);
  const [myDeadline, setMyDeadline] = useState(initialMyDeadline ?? '');
  const savedDeadline = useRef<string | null>(initialMyDeadline ?? ''); // null: last save failed
  const [myLabel, setMyLabel] = useState(initialMyDeadlineLabel);
  const savedLabel = useRef<string | null>(initialMyDeadlineLabel);
  // Deadline saves run one after another, so a slow earlier save cannot land after a later one
  const deadlineQueue = useRef<Promise<void>>(Promise.resolve());
  const [deadlineState, setDeadlineState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [deadlineError, setDeadlineError] = useState('');

  const patch = (fields: Record<string, unknown>) =>
    fetch(`/api/opportunities/${opportunityId}/personal`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
      keepalive: true // lets a save started while leaving the page finish
    });

  const saveDeadline = (fields: { my_deadline?: string | null; my_deadline_label?: string }) => {
    if (fields.my_deadline !== undefined) savedDeadline.current = fields.my_deadline ?? '';
    if (fields.my_deadline_label !== undefined) savedLabel.current = fields.my_deadline_label;
    deadlineQueue.current = deadlineQueue.current.then(async () => {
      setDeadlineState('saving');
      setDeadlineError('');
      try {
        const res = await patch(fields);
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message || `HTTP ${res.status}`);
        }
        onSaved?.(fields);
        setDeadlineState('saved');
      } catch (err: any) {
        // Forget the failed value so the next change or blur tries again
        if (fields.my_deadline !== undefined) savedDeadline.current = null;
        if (fields.my_deadline_label !== undefined) savedLabel.current = null;
        setDeadlineState('error');
        setDeadlineError(err.message);
      }
    });
  };

  // A typed date passes through partial values (0002-05-01, 0020-05-01, ...): only save once the
  // user pauses on a plausible year, or leaves the field
  const flushDeadline = () => {
    if (myDeadline === savedDeadline.current) return;
    if (myDeadline && Number(myDeadline.slice(0, 4)) < 1900) return;
    saveDeadline({ my_deadline: myDeadline || null, my_deadline_label: myLabel.trim() });
  };
  useEffect(() => {
    const t = setTimeout(flushDeadline, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myDeadline]);

  // Notes saves also run one after another, so an older text can never land after a newer one
  const notesQueue = useRef<Promise<void>>(Promise.resolve());
  const save = (value: string) => {
    notesQueue.current = notesQueue.current.then(async () => {
      if (value === lastSaved.current) return; // a later queued save already covers it
      setSaveState('saving');
      try {
        const res = await patch({ notes: value });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        lastSaved.current = value;
        if (pending.current === value) pending.current = null;
        onSaved?.({ notes: value });
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    });
    return notesQueue.current;
  };

  // Autosave 800 ms after typing stops
  useEffect(() => {
    if (notes === lastSaved.current) return;
    pending.current = notes;
    const t = setTimeout(() => save(notes), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  // Flush unsaved text when the panel unmounts (navigating away)
  useEffect(
    () => () => {
      if (pending.current !== null && pending.current !== lastSaved.current) void save(pending.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <Panel
      title="Your application"
      actions={<Badge tone={STAGE[status].tone} icon={STAGE[status].icon}>{STAGE[status].label}</Badge>}
    >
      <div className="flex flex-col gap-5">
        {/* Progress */}
        <ol className="grid grid-cols-3 gap-2" aria-label="Application progress">
          {STEPS.map((label, i) => {
            const done = i < step || (i === 2 && step === 2);
            const current = i === step;
            return (
              <li key={label} aria-current={current ? 'step' : undefined} className="flex flex-col gap-1.5">
                <span className={`h-1.5 rounded-full ${i <= step ? 'bg-primary' : 'bg-surface-container-high'}`} />
                <span className={`text-body-sm ${current ? 'font-semibold text-on-surface' : 'text-on-surface-variant'}`}>
                  {i === 2 && step === 2 ? STAGE[status].short : label}
                  {done && i < step && <span className="sr-only"> (done)</span>}
                </span>
              </li>
            );
          })}
        </ol>

        {/* Next action for this stage */}
        <div className="flex flex-wrap items-center gap-2">
          {status === 'pursuing' && (
            <>
              <Button variant="primary" icon="send" disabled={busy} onClick={() => onStatusChange('applied')}>
                Mark as submitted
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => onStatusChange('new')}>
                Stop tracking
              </Button>
            </>
          )}
          {status === 'applied' && (
            <>
              <span className="text-body-sm text-on-surface-variant w-full">Heard back? Record the result:</span>
              <Button variant="primary" icon="emoji_events" disabled={busy} onClick={() => onStatusChange('awarded')}>
                Funded or accepted
              </Button>
              <Button disabled={busy} onClick={() => onStatusChange('not_awarded')}>
                Not funded
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => onStatusChange('pursuing')}>
                Back to preparing
              </Button>
            </>
          )}
          {(status === 'awarded' || status === 'not_awarded') && (
            <>
              <p className="text-body-sm text-on-surface-variant w-full">
                {status === 'awarded'
                  ? 'Congratulations. Keep notes on what worked; they help with the next proposal.'
                  : 'Noted. Calls like this one stay in your feed; a note on the reviewers’ feedback helps next time.'}
              </p>
              <Button variant="ghost" icon="undo" disabled={busy} onClick={() => onStatusChange('applied')}>
                Change result
              </Button>
            </>
          )}
        </div>

        {/* The user's own deadline, e.g. the institution's sign-off before the agency deadline.
            Hidden once there is a result: reminders only run while preparing or submitted. */}
        {step < 2 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-body-sm font-semibold text-on-surface">
            Your own deadline <span className="font-normal text-on-surface-variant">(optional)</span>
          </legend>
          <p className="text-body-sm text-on-surface-variant">
            For example, when your institution needs it signed. You get reminders for it like any other deadline.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-[11rem_1fr] gap-2">
            <label className="sr-only" htmlFor={`my-deadline-${opportunityId}`}>Date</label>
            <input
              id={`my-deadline-${opportunityId}`}
              type="date"
              value={myDeadline}
              onChange={(e) => setMyDeadline(e.target.value)}
              onBlur={flushDeadline}
              className="w-full min-h-11 sm:min-h-10 rounded-lg border border-outline bg-surface text-body-md text-on-surface px-3 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <label className="sr-only" htmlFor={`my-deadline-label-${opportunityId}`}>What is due</label>
            <input
              id={`my-deadline-label-${opportunityId}`}
              type="text"
              maxLength={MY_DEADLINE_LABEL_MAX}
              placeholder="What is due, e.g. Institution sign-off"
              value={myLabel}
              onChange={(e) => setMyLabel(e.target.value)}
              onBlur={() => myLabel.trim() !== savedLabel.current && saveDeadline({ my_deadline_label: myLabel.trim() })}
              className="w-full min-h-11 sm:min-h-10 rounded-lg border border-outline bg-surface text-body-md text-on-surface px-3 placeholder:text-on-surface-variant/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <p role="status" aria-live="polite" className={`text-[12px] ${deadlineState === 'error' ? 'text-error' : 'text-on-surface-variant'}`}>
            {deadlineState === 'error'
              ? `Not saved: ${deadlineError}`
              : deadlineState === 'saving'
                ? 'Saving…'
                : myDeadline
                  ? (() => {
                      const d = daysUntil(myDeadline);
                      const when = d < 0 ? 'has passed' : `is ${relativeDays(d)}`;
                      return `${formatDeadline(myDeadline)} ${when}.${deadlineState === 'saved' ? ' Saved.' : ''}`;
                    })()
                  : deadlineState === 'saved'
                    ? 'Removed.'
                    : ''}
          </p>
        </fieldset>
        )}

        {/* Notes */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={`notes-${opportunityId}`} className="text-body-sm font-semibold text-on-surface">
              Notes <span className="font-normal text-on-surface-variant">(only you can see these)</span>
            </label>
            <span role="status" aria-live="polite" className={`text-[12px] ${saveState === 'error' ? 'text-error' : 'text-on-surface-variant'}`}>
              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Not saved. Check your connection.' : ''}
            </span>
          </div>
          <textarea
            id={`notes-${opportunityId}`}
            rows={4}
            maxLength={NOTES_MAX}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== lastSaved.current && save(notes)}
            placeholder="Co-PIs, budget limit, documents to collect, who signs the endorsement…"
            className="w-full rounded-lg border border-outline bg-surface text-body-md text-on-surface px-3 py-2.5 leading-relaxed placeholder:text-on-surface-variant/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          {saveState === 'error' && (
            <button type="button" onClick={() => save(notes)} className="self-start text-body-sm text-primary underline underline-offset-4">
              Try saving again
            </button>
          )}
        </div>

        <Link href="/applications" className="self-start inline-flex items-center gap-1 text-body-sm text-primary hover:underline underline-offset-4">
          All your applications
          <Icon name="arrow_forward" className="text-[16px]" />
        </Link>
      </div>
    </Panel>
  );
}
