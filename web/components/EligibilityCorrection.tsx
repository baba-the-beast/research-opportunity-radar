'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import { CORRECTIONS } from '@/lib/eligibility';

/** "Is this wrong?" on one eligibility check. Reports go to the operator to fix the rule. */
export function EligibilityCorrection({
  opportunityId,
  ruleName,
  verdict,
  excerpt
}: {
  opportunityId: string;
  ruleName: string;
  verdict: string;
  excerpt?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [correction, setCorrection] = useState<string>(CORRECTIONS[0].value);
  const [comment, setComment] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  if (state === 'sent') {
    return <p className="text-body-sm text-on-surface-variant">Thanks. This is used to fix the eligibility check.</p>;
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start text-body-sm text-primary underline underline-offset-4">
        Is this wrong?
      </button>
    );
  }

  const submit = async () => {
    setState('sending');
    setError('');
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/eligibility-correction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule_name: ruleName, verdict_shown: verdict, correction, comment, excerpt: excerpt ?? null })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message || `HTTP ${res.status}`);
      }
      setState('sent');
    } catch (err: any) {
      setError(err.message);
      setState('error');
    }
  };

  const groupId = `correction-${ruleName}`;
  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border border-outline-variant p-3">
      <legend className="px-1 text-body-sm font-semibold text-on-surface">What is wrong with this check?</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {CORRECTIONS.map((c) => (
          <label key={c.value} className="flex items-center gap-2 text-body-sm text-on-surface min-h-11 sm:min-h-0">
            <input type="radio" name={groupId} value={c.value} checked={correction === c.value} onChange={() => setCorrection(c.value)} />
            {c.label}
          </label>
        ))}
      </div>
      <label className="sr-only" htmlFor={`${groupId}-comment`}>Details (optional)</label>
      <textarea
        id={`${groupId}-comment`}
        rows={2}
        maxLength={1000}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Details (optional), e.g. the age relaxation that applies to you"
        className="w-full rounded-lg border border-outline bg-surface text-body-sm text-on-surface px-3 py-2 placeholder:text-on-surface-variant/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={state === 'sending'} onClick={submit}>
          {state === 'sending' ? 'Sending…' : 'Send'}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        {state === 'error' && <span role="alert" className="text-body-sm text-error">Not sent: {error}</span>}
      </div>
    </fieldset>
  );
}
