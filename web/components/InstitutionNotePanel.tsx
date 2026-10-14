'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Panel } from '@/components/ui';
import { daysUntil, formatDeadline, relativeDays } from '@/lib/dates';

interface InstitutionNote {
  internal_deadline: string | null;
  note: string;
  recommended: boolean;
}

interface NoteResponse {
  institution: string;
  note: InstitutionNote | null;
  can_edit: boolean;
  faculty_count?: number | null;
}

/**
 * The research office's note on a call for the viewer's institution. Faculty see it when one exists;
 * research office accounts can set it. Renders nothing for anyone else.
 */
export function InstitutionNotePanel({ opportunityId }: { opportunityId: string }) {
  const [data, setData] = useState<NoteResponse | null>(null);
  const [draft, setDraft] = useState<InstitutionNote>({ internal_deadline: null, note: '', recommended: false });
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/opportunities/${opportunityId}/institution-note`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: NoteResponse | null) => {
        if (!body) return;
        setData(body);
        if (body.note) setDraft({ internal_deadline: body.note.internal_deadline, note: body.note.note || '', recommended: body.note.recommended });
      })
      .catch(() => setData(null));
  }, [opportunityId]);

  if (!data || (!data.can_edit && !data.note)) return null;

  const save = async () => {
    setState('saving');
    setError('');
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/institution-note`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, note: draft.note.trim() })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message || `HTTP ${res.status}`);
      }
      setData({ ...data, note: { ...draft } });
      setState('saved');
    } catch (err: any) {
      setError(err.message);
      setState('error');
    }
  };

  const note = data.note;
  return (
    <Panel
      title="Your research office"
      description={data.institution}
      actions={note?.recommended ? <Badge tone="success" icon="verified">Recommended</Badge> : undefined}
    >
      <div className="flex flex-col gap-4">
        {note && (note.internal_deadline || note.note) && (
          <div className="flex flex-col gap-1.5">
            {note.internal_deadline && (
              <p className="text-body-md text-on-surface">
                <span className="font-semibold">Internal deadline:</span> {formatDeadline(note.internal_deadline)}
                {daysUntil(note.internal_deadline) >= 0 && `, ${relativeDays(daysUntil(note.internal_deadline))}`}.
                <span className="text-on-surface-variant"> Send your proposal to the office by then so it can be forwarded in time.</span>
              </p>
            )}
            {note.note && <p className="text-body-md text-on-surface whitespace-pre-line">{note.note}</p>}
          </div>
        )}

        {data.can_edit && (
          <fieldset className="flex flex-col gap-3 border-t border-outline-variant pt-4">
            <legend className="text-body-sm font-semibold text-on-surface">
              Set for your institution{typeof data.faculty_count === 'number' && (
                <span className="font-normal text-on-surface-variant"> ({data.faculty_count} faculty profile{data.faculty_count === 1 ? '' : 's'} with this institution name)</span>
              )}
            </legend>
            <label className="flex items-center gap-2 text-body-sm text-on-surface min-h-11 sm:min-h-0">
              <input type="checkbox" checked={draft.recommended} onChange={(e) => setDraft({ ...draft, recommended: e.target.checked })} />
              Recommend this call to faculty at {data.institution}
            </label>
            <label className="flex flex-col gap-1 text-body-sm text-on-surface">
              Internal deadline (optional)
              <input
                type="date"
                value={draft.internal_deadline ?? ''}
                onChange={(e) => setDraft({ ...draft, internal_deadline: e.target.value || null })}
                className="w-full sm:w-48 min-h-11 sm:min-h-10 rounded-lg border border-outline bg-surface px-3 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="flex flex-col gap-1 text-body-sm text-on-surface">
              Note to faculty (optional)
              <textarea
                rows={2}
                maxLength={1000}
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                placeholder="e.g. Only one proposal can be forwarded: send a 2-page concept note first"
                className="w-full rounded-lg border border-outline bg-surface px-3 py-2 text-body-md text-on-surface placeholder:text-on-surface-variant/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" disabled={state === 'saving'} onClick={save}>
                {state === 'saving' ? 'Saving…' : 'Save for institution'}
              </Button>
              <span role="status" aria-live="polite" className={`text-body-sm ${state === 'error' ? 'text-error' : 'text-on-surface-variant'}`}>
                {state === 'saved' ? 'Saved. Faculty at your institution see this now.' : state === 'error' ? `Not saved: ${error}` : ''}
              </span>
            </div>
          </fieldset>
        )}
      </div>
    </Panel>
  );
}
