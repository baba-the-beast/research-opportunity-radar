'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { DISMISS_REASONS, PENALISING_REASON, suggestTopicTerms, type DismissReason } from '@/lib/feedback';

export interface DismissChoice {
  reason: DismissReason;
  negative_terms: string[];
  feedback_text?: string;
}

/**
 * Inline "why isn't this relevant?" form. Only "Not my research area" lowers similar calls, and the
 * user picks which title words count, instead of the server guessing silently.
 */
export function DismissPanel({ title, onConfirm, onCancel, busy }: { title: string; onConfirm: (c: DismissChoice) => void; onCancel: () => void; busy?: boolean }) {
  const suggestions = suggestTopicTerms(title);
  const [reason, setReason] = useState<DismissReason>(PENALISING_REASON);
  const [terms, setTerms] = useState<string[]>(suggestions);
  const [note, setNote] = useState('');
  const groupId = useId();
  const first = useRef<HTMLInputElement>(null);

  // Move focus into the form when it opens, so keyboard and screen-reader users land on it
  useEffect(() => first.current?.focus(), []);

  const selected = DISMISS_REASONS.find((r) => r.value === reason)!;
  const topicWithoutTerms = reason === PENALISING_REASON && terms.length === 0;

  return (
    <form
      className="rounded-2xl surface-card bg-surface p-5 flex flex-col gap-4"
      aria-labelledby={`${groupId}-title`}
      onSubmit={(e) => {
        e.preventDefault();
        onConfirm({ reason, negative_terms: reason === PENALISING_REASON ? terms : [], feedback_text: note.trim() || undefined });
      }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <h2 id={`${groupId}-title`} className="font-headline-sm text-headline-sm text-on-surface">
        Why isn&apos;t this call relevant?
      </h2>

      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">Reason</legend>
        {DISMISS_REASONS.map((r, i) => (
          <label key={r.value} className="flex items-center gap-3 min-h-11 sm:min-h-9 px-2 -mx-2 rounded-lg cursor-pointer hover:bg-surface-container">
            <input
              ref={i === 0 ? first : undefined}
              type="radio"
              name={`${groupId}-reason`}
              value={r.value}
              checked={reason === r.value}
              onChange={() => setReason(r.value)}
              className="w-4 h-4 accent-primary"
            />
            <span className="text-body-md text-on-surface">{r.label}</span>
          </label>
        ))}
      </fieldset>

      {reason === PENALISING_REASON && suggestions.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-body-sm font-semibold text-on-surface">Topics you don&apos;t work on</legend>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((t) => {
              const on = terms.includes(t);
              return (
                <label
                  key={t}
                  className={`inline-flex items-center gap-1.5 min-h-11 sm:min-h-8 px-3 rounded-full border text-body-sm cursor-pointer transition-colors ${
                    on ? 'border-primary bg-primary-soft text-primary font-semibold' : 'border-outline text-on-surface-variant'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => setTerms(e.target.checked ? [...terms, t] : terms.filter((x) => x !== t))}
                    className="sr-only"
                  />
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">{on ? 'check' : 'add'}</span>
                  {t}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      <p className="text-body-sm text-on-surface-variant">
        {topicWithoutTerms ? 'No topics picked, so your matches stay the same.' : selected.hint}
      </p>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${groupId}-note`} className="text-body-sm font-semibold text-on-surface">
          Anything else? <span className="font-normal text-on-surface-variant">(optional)</span>
        </label>
        <input
          id={`${groupId}-note`}
          type="text"
          maxLength={300}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full min-h-11 sm:min-h-10 rounded-lg border border-outline bg-surface text-body-md text-on-surface px-3 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" icon="visibility_off" disabled={busy}>
          Hide this call
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
