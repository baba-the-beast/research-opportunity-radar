'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Notice } from '@/components/ui';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000;

type Status =
  | { kind: 'idle' }
  | { kind: 'waiting'; url: string }
  | { kind: 'info'; message: string }
  | { kind: 'error'; message: string };

/**
 * "Connect Telegram" flow: gets a one-time t.me deep link, opens it, then polls settings until the
 * bot webhook has linked the chat. Users never need to know or type a chat id.
 */
export function TelegramConnect({
  connected,
  onConnectionChange
}: {
  connected: boolean;
  onConnectionChange: (settings: { telegram_chat_id: string | null; telegram_alerts: boolean }) => void;
}) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };
  useEffect(() => stopPolling, []);

  const errorMessage = async (res: Response) => {
    const body = await res.json().catch(() => null);
    return body?.error?.message || `Request failed (HTTP ${res.status}).`;
  };

  const connect = async () => {
    setBusy(true);
    setStatus({ kind: 'idle' });
    // Open the tab synchronously (inside the click) so popup blockers allow it; navigate it once
    // the link is ready.
    const tab = window.open('', '_blank');
    try {
      const res = await fetch('/api/telegram/link', { method: 'POST' });
      if (!res.ok) {
        tab?.close();
        setStatus({ kind: 'error', message: await errorMessage(res) });
        return;
      }
      const { data } = await res.json();
      if (tab) {
        tab.opener = null;
        tab.location.href = data.url;
      }
      setStatus({ kind: 'waiting', url: data.url });

      const startedAt = Date.now();
      stopPolling();
      pollRef.current = setInterval(async () => {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          stopPolling();
          setStatus({ kind: 'error', message: 'Still not connected. Open the link, press Start in Telegram, then try again.' });
          return;
        }
        const poll = await fetch('/api/settings').then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (poll?.telegram_chat_id) {
          stopPolling();
          onConnectionChange({ telegram_chat_id: poll.telegram_chat_id, telegram_alerts: true });
          setStatus({ kind: 'info', message: 'Connected. Check Telegram for a confirmation message.' });
        }
      }, POLL_INTERVAL_MS);
    } catch {
      tab?.close();
      setStatus({ kind: 'error', message: 'Could not reach the server. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/telegram/test', { method: 'POST' });
      if (res.ok) {
        setStatus({ kind: 'info', message: 'Test message sent. Check Telegram.' });
      } else {
        if (res.status === 409) onConnectionChange({ telegram_chat_id: null, telegram_alerts: false });
        setStatus({ kind: 'error', message: await errorMessage(res) });
      }
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegram_chat_id: null, telegram_alerts: false })
      });
      if (res.ok) {
        onConnectionChange({ telegram_chat_id: null, telegram_alerts: false });
        setStatus({ kind: 'info', message: 'Telegram disconnected.' });
      } else {
        setStatus({ kind: 'error', message: await errorMessage(res) });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl bg-surface-container-low border border-outline-variant p-4 flex flex-col gap-3">
      {connected ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon="send" onClick={sendTest} disabled={busy}>
            Send test message
          </Button>
          <Button variant="ghost" onClick={disconnect} disabled={busy}>
            Disconnect Telegram
          </Button>
        </div>
      ) : (
        <>
          <p className="text-body-sm text-on-surface-variant">
            Opens our bot in Telegram. Press <strong className="text-on-surface">Start</strong> there and this page connects by itself.
          </p>
          <Button variant="primary" icon="link" onClick={connect} disabled={busy || status.kind === 'waiting'} className="self-start">
            {status.kind === 'waiting' ? 'Waiting for Telegram…' : 'Connect Telegram'}
          </Button>
        </>
      )}

      {status.kind === 'waiting' && (
        <p className="text-body-sm text-on-surface-variant">
          No new tab?{' '}
          <a href={status.url} target="_blank" rel="noopener noreferrer" className="text-primary font-semibold underline underline-offset-4">
            Open the Telegram link
          </a>
        </p>
      )}
      {status.kind === 'info' && <Notice tone="success">{status.message}</Notice>}
      {status.kind === 'error' && <Notice tone="danger">{status.message}</Notice>}
    </div>
  );
}
