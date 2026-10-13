import { NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/auth';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';
import { consumeRateLimit } from '@/lib/rateLimit';
import { getRequestSupabase, requireUserAccount } from '@/lib/routeContext';
import { getTelegramConfig, sendToOwnTelegram, shareTextToTelegramHtml } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

// Telegram allows 4096 characters per message; leave room for the HTML tags added to *bold*
const sendSchema = z.object({ text: z.string().trim().min(1).max(3500) });

/** Sends a call or digest (text from lib/share.ts) to the caller's own connected Telegram chat. */
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated) {
      return auth.errorResponse!;
    }
    const noAccount = requireUserAccount(auth.user, req);
    if (noAccount) {
      return noAccount;
    }

    const telegram = getTelegramConfig();
    if (!telegram) {
      return createErrorResponse('NOT_CONFIGURED', 'Telegram is not set up on this server yet.', 501, req);
    }

    const rate = await consumeRateLimit(`telegram_send_${auth.user!.id}`, 10, 60 * 1000);
    if (!rate.allowed) {
      return createErrorResponse('RATE_LIMIT_EXCEEDED', 'Too many sends. Wait a minute and try again.', 429, req);
    }

    const parsed = sendSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return createErrorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message || 'Invalid payload', 400, req);
    }

    try {
      const result = await sendToOwnTelegram(
        getRequestSupabase(auth.user),
        auth.user!.id,
        telegram.token,
        shareTextToTelegramHtml(parsed.data.text)
      );
      if (result === 'not_connected') {
        return createErrorResponse('NOT_CONNECTED', 'Connect Telegram in Settings first.', 400, req);
      }
      if (result === 'blocked') {
        return createErrorResponse('TELEGRAM_BLOCKED', 'The bot can no longer message your chat. Connect Telegram again in Settings.', 409, req);
      }
    } catch (err) {
      return createErrorResponse('TELEGRAM_ERROR', (err as Error).message, 502, req);
    }

    return createSuccessResponse({ sent: true }, req);
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
