/**
 * Server-only Telegram Bot API helpers for the connect flow and test messages.
 * The bot token lives in the request URL, so errors never include the URL or response body verbatim.
 */

const TELEGRAM_TIMEOUT_MS = 8000;

export interface TelegramConfig {
  token: string;
  botUsername: string;
  webhookSecret: string;
}

/** Null unless the bot token, public bot username and webhook secret are all configured. */
export function getTelegramConfig(): TelegramConfig | null {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const botUsername = (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
  return token && botUsername && webhookSecret ? { token, botUsername, webhookSecret } : null;
}

export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class TelegramSendError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Sends an HTML-formatted message. Throws TelegramSendError (403 = user blocked the bot). */
export async function sendTelegramMessage(token: string, chatId: string, html: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
      cache: 'no-store'
    });
  } catch (err: any) {
    throw new TelegramSendError(`Telegram request failed (${err?.name || 'network error'})`, 0);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const description = typeof body?.description === 'string' ? body.description.slice(0, 120) : '';
    throw new TelegramSendError(`Telegram API returned HTTP ${res.status}${description ? `: ${description}` : ''}`, res.status);
  }
}

/** A 24-byte random code; Telegram deep-link start parameters allow [A-Za-z0-9_-], max 64 chars. */
export function newLinkCode(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}
