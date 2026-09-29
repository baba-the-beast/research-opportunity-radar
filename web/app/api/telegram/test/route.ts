import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';
import { consumeRateLimit } from '@/lib/rateLimit';
import { getRequestSupabase, requireUserAccount } from '@/lib/routeContext';
import { getTelegramConfig, sendTelegramMessage, TelegramSendError } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

/** Sends a test message to the caller's connected Telegram chat. */
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
      return createErrorResponse('NOT_CONFIGURED', 'Telegram alerts are not set up on this server yet.', 501, req);
    }

    const rate = await consumeRateLimit(`telegram_test_${auth.user!.id}`, 3, 60 * 1000);
    if (!rate.allowed) {
      return createErrorResponse('RATE_LIMIT_EXCEEDED', 'Please wait a minute before sending another test.', 429, req);
    }

    const supabase = getRequestSupabase(auth.user);
    const { data: prefs, error } = await supabase
      .from('user_preferences')
      .select('telegram_chat_id')
      .eq('user_id', auth.user!.id)
      .maybeSingle();
    if (error) {
      return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
    }
    if (!prefs?.telegram_chat_id) {
      return createErrorResponse('NOT_CONNECTED', 'Connect Telegram first.', 400, req);
    }

    try {
      await sendTelegramMessage(
        telegram.token,
        prefs.telegram_chat_id,
        '🔔 <b>Test alert</b>\n\nTelegram notifications from Research Opportunity Radar are working.'
      );
    } catch (err) {
      if (err instanceof TelegramSendError && err.status === 403) {
        // Blocked or deleted chat: disconnect so the pipeline stops trying
        await supabase
          .from('user_preferences')
          .update({ telegram_chat_id: null, telegram_alerts: false, updated_at: new Date().toISOString() })
          .eq('user_id', auth.user!.id);
        return createErrorResponse(
          'TELEGRAM_BLOCKED',
          'The bot can no longer message this chat (it was blocked or deleted). Connect Telegram again.',
          409,
          req
        );
      }
      return createErrorResponse('TELEGRAM_ERROR', (err as Error).message, 502, req);
    }

    return createSuccessResponse({ sent: true }, req);
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
