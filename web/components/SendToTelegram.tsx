'use client';

import { useState } from 'react';
import Link from 'next/link';
import { buttonClass, Icon, type ButtonVariant } from '@/components/ui';

type SendState = 'idle' | 'sending' | 'sent' | 'not_connected' | 'error';

/**
 * Sends `text` (from lib/share.ts) to the user's own connected Telegram chat through the bot, so
 * they can forward it from there. If Telegram is not connected yet, it points to Settings.
 * `iconOnly` renders a compact square button for dense lists (label kept for screen readers).
 */
export function SendToTelegram({
  text,
  label = 'Send to Telegram',
  variant = 'secondary',
  iconOnly = false,
  className
}: {
  text: string;
  label?: string;
  variant?: ButtonVariant;
  iconOnly?: boolean;
  className?: string;
}) {
  const [state, setState] = useState<SendState>('idle');
  const [error, setError] = useState('');

  const send = async () => {
    setState('sending');
    setError('');
    try {
      const res = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      if (res.ok) {
        setState('sent');
        setTimeout(() => setState((s) => (s === 'sent' ? 'idle' : s)), 3000);
        return;
      }
      const body = await res.json().catch(() => null);
      const code = body?.error?.code;
      if (code === 'NOT_CONNECTED' || code === 'TELEGRAM_BLOCKED') {
        setState('not_connected');
        return;
      }
      setError(body?.error?.message || `HTTP ${res.status}`);
      setState('error');
    } catch {
      setError('Check your connection and try again.');
      setState('error');
    }
  };

  const icon = state === 'sent' ? 'check' : 'send';
  const shown = state === 'sending' ? 'Sending…' : state === 'sent' ? 'Sent to Telegram' : label;
  const status =
    state === 'not_connected' ? (
      <span className="text-body-sm text-on-surface-variant">
        <Link href="/settings" className="text-primary underline underline-offset-4">Connect Telegram</Link> first.
      </span>
    ) : state === 'error' ? (
      <span className="text-body-sm text-error">Not sent: {error}</span>
    ) : null;

  if (iconOnly) {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={send}
          disabled={state === 'sending'}
          aria-label={shown}
          title={shown}
          className={`inline-flex items-center justify-center w-11 h-11 sm:w-9 sm:h-9 rounded-lg hover:bg-surface-container transition-colors disabled:opacity-50 ${
            state === 'sent' ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'
          } ${className ?? ''}`}
        >
          <Icon name={icon} className="text-[20px]" />
        </button>
        <span role="status" aria-live="polite">{status}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={send} disabled={state === 'sending'} className={buttonClass(variant, className)}>
        <Icon name={icon} />
        {shown}
      </button>
      <span role="status" aria-live="polite">{status}</span>
    </span>
  );
}
