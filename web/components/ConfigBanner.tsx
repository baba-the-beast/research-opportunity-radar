'use client';

import { useEffect, useState } from 'react';

/** Shown only when the deployment has no working database, so a misconfiguration is obvious. */
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
    <div className="mx-4 sm:mx-8 mt-4 rounded-xl border border-tertiary/30 bg-tertiary-container px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-body-sm text-on-tertiary-container">
      <span className="material-symbols-outlined text-[18px] shrink-0" aria-hidden="true">warning</span>
      <p className="flex-1">
        <span className="font-semibold">Database not connected.</span> Missing {status.missing.join(', ')}. Copy{' '}
        <code>.env.example</code> to <code>.env.local</code> and fill them in.
      </p>
      <button
        onClick={() => setDismissed(true)}
        className="self-start sm:self-center font-semibold hover:underline"
      >
        Dismiss
      </button>
    </div>
  );
}
