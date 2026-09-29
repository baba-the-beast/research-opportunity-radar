import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';
import { consumeRateLimit } from '@/lib/rateLimit';
import { requireUserAccount } from '@/lib/routeContext';
import { getSupabaseAdminClient } from '@/lib/supabaseServerClient';
import { getTelegramConfig, newLinkCode } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

const LINK_TTL_MS = 15 * 60 * 1000;

/**
 * Issues a one-time deep link (t.me/<bot>?start=<code>). Opening it and pressing Start sends
 * "/start <code>" to the bot; the webhook then binds that private chat to this user.
 */
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
      return createErrorResponse(
        'NOT_CONFIGURED',
        'Telegram alerts are not set up on this server yet (TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, TELEGRAM_WEBHOOK_SECRET).',
        501,
        req
      );
    }

    const rate = await consumeRateLimit(`telegram_link_${auth.user!.id}`, 5, 10 * 60 * 1000);
    if (!rate.allowed) {
      return createErrorResponse('RATE_LIMIT_EXCEEDED', 'Too many connect attempts. Try again in a few minutes.', 429, req);
    }

    // Codes are service-role only (RLS enabled, no client policies)
    const admin = getSupabaseAdminClient();
    const userId = auth.user!.id;
    const code = newLinkCode();
    const expiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString();

    const { error: delErr } = await admin.from('telegram_link_codes').delete().eq('user_id', userId);
    if (delErr) {
      return createErrorResponse('DATABASE_ERROR', delErr.message, 500, req);
    }
    const { error } = await admin.from('telegram_link_codes').insert({ code, user_id: userId, expires_at: expiresAt });
    if (error) {
      return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
    }

    return createSuccessResponse(
      { url: `https://t.me/${telegram.botUsername}?start=${code}`, bot_username: telegram.botUsername, expires_at: expiresAt },
      req
    );
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
