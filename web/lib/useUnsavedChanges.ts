'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Tracks whether a form differs from its last loaded or saved state, and warns before the tab is
 * closed or reloaded with unsaved edits.
 *
 * `value` is anything JSON-serialisable describing the form; `ready` is false until it has loaded.
 * Call `markSaved()` after a successful save, and `allowLeave()` before an intentional reload.
 */
export function useUnsavedChanges(value: unknown, ready: boolean) {
  const current = JSON.stringify(value);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [pendingClean, setPendingClean] = useState(false);
  const leaving = useRef(false);

  useEffect(() => {
    if (ready && baseline === null) setBaseline(current);
  }, [ready, baseline, current]);

  // Re-baseline on the render after a save, once the saved values have settled into state
  useEffect(() => {
    if (pendingClean) {
      setBaseline(current);
      setPendingClean(false);
    }
  }, [pendingClean, current]);

  const dirty = baseline !== null && current !== baseline;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (leaving.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return {
    dirty,
    markSaved: () => setPendingClean(true),
    allowLeave: () => {
      leaving.current = true;
    }
  };
}
