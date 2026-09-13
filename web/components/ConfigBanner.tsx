'use client';

import { useEffect, useState } from 'react';

export function ConfigBanner() {
  const [status, setStatus] = useState<{
    configured: boolean;
    database_connected: boolean;
    allow_in_memory: boolean;
    missing: string[];
  } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetch('/api/config/status')
      .then((r) => r.json())
      .then((data) => setStatus(data))
      .catch(() => {});
  }, []);

  if (dismissed || !status || status.database_connected) {
    return null;
  }

  return (
    <div className="bg-surface-container border-b border-primary/40 text-on-surface px-space-xl py-space-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-space-sm z-50 sticky top-14">
      <div className="flex items-center gap-space-sm">
        <span className="material-symbols-outlined text-[18px] text-primary shrink-0">info</span>
        <div className="flex flex-wrap items-center gap-x-space-sm gap-y-1">
          <span className="font-data-mono-sm text-data-mono-sm font-bold text-primary uppercase tracking-wider">
            [ OBSERVATORY CALIBRATION NOTICE ]
          </span>
          <span className="text-body-sm text-on-surface-variant font-mono text-xs">
            Supabase credentials unconfigured ({status.missing.join(', ')}). Live database sync paused.
          </span>
        </div>
      </div>
      <div className="flex items-center gap-space-md self-end sm:self-center">
        <span className="font-data-mono-sm text-data-mono-sm text-xs text-outline">
          Copy <code className="text-primary font-mono">.env.example</code> to <code className="text-primary font-mono">.env.local</code>
        </span>
        <button
          onClick={() => setDismissed(true)}
          className="text-on-surface-variant hover:text-on-surface text-xs font-mono uppercase px-2 py-0.5 rounded border border-surface-container-high hover:bg-surface-container-high transition-colors"
          title="Dismiss notice"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
