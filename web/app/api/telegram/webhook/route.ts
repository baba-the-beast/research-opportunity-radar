import { NextRequest, NextResponse } from 'next/server';
import { timingSafeMatch } from '@/lib/auth';
import { getSupabaseAdminClient } from '@/lib/supabaseServerClient';
import { escapeTelegramHtml, getTelegramConfig, sendTelegramMessage } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

const ok = () => NextResponse.json({ ok: true });

/**
 * Telegram Bot API webhook (registered by scripts/telegram_setup.py).
 *
 * Auth: Telegram echoes the secret given to setWebhook in X-Telegram-Bot-Api-Secret-Token; anything
 * else is rejected. Verified updates always get a 200, even when ignored, because Telegram retries
 * non-2xx deliveries and would otherwise replay the same update.
 *
 *   /start <code>  bind this private chat to the user who generated <code> in Settings
 *   /start         explain how to connect
 *   /stop          stop alerts to this chat
 */
export async function POST(req: NextRequest) {
  const telegram = getTelegramConfig();
  if (!telegram) {
    return NextResponse.json({ error: 'Telegram is not configured' }, { status: 503 });
  }
  const secret = req.headers.get('x-telegram-bot-api-secret-token') || '';
  if (!timingSafeMatch(secret, telegram.webhookSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return ok();
  }

  const message = update?.message;
  const chat = message?.chat;
  const text: string = typeof message?.text === 'string' ? message.text.trim() : '';
  // Alerts are personal: only private chats can be linked (not groups the bot was added to)
  if (!chat || chat.type !== 'private' || !text.startsWith('/')) {
    return ok();
  }

  const chatId = String(chat.id);
  const reply = (html: string) =>
    sendTelegramMessage(telegram.token, chatId, html).catch((err) =>
      console.error('[telegram webhook] reply failed:', err.message)
    );
  const admin = getSupabaseAdminClient();
  const [command, arg = ''] = text.split(/\s+/, 2);
  const cmd = command.toLowerCase().replace(/@.*$/, ''); // "/start@MyBot" in some clients

  try {
    if (cmd === '/start' && arg) {
      const { data: link, error } = await admin
        .from('telegram_link_codes')
        .select('user_id, expires_at')
        .eq('code', arg)
        .maybeSingle();
      if (error) throw new Error(error.message);

      if (!link || new Date(link.expires_at).getTime() < Date.now()) {
        await reply(
          'This connect link has expired or was already used.\n\nOpen <b>Settings → Connect Telegram</b> in Research Opportunity Radar to get a new one.'
        );
        return ok();
      }

      // One-time: consume before linking so a replayed update can't re-bind the chat
      await admin.from('telegram_link_codes').delete().eq('code', arg);

      // A chat belongs to one account: unlink it anywhere else first
      await admin
        .from('user_preferences')
        .update({ telegram_chat_id: null, telegram_alerts: false, updated_at: new Date().toISOString() })
        .eq('telegram_chat_id', chatId)
        .neq('user_id', link.user_id);

      const { error: upErr } = await admin.from('user_preferences').upsert(
        {
          user_id: link.user_id,
          telegram_chat_id: chatId,
          telegram_alerts: true,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'user_id' }
      );
      if (upErr) throw new Error(upErr.message);

      await admin.from('user_activity').insert({
        user_id: link.user_id,
        event_type: 'preferences_update',
        title: 'Connected Telegram alerts',
        description: 'Telegram chat linked via the Research Opportunity Radar bot.',
        metadata: { channel: 'telegram' }
      });

      const name = escapeTelegramHtml(String(message.from?.first_name || 'there'));
      await reply(
        `✅ Connected, ${name}!\n\nYou'll get new high-relevance opportunities and urgent (≤72h) deadline alerts here.\n\nSend /stop at any time to turn them off.`
      );
      return ok();
    }

    if (cmd === '/start') {
      await reply(
        '👋 This bot sends Research Opportunity Radar alerts.\n\nTo connect, open <b>Settings → Connect Telegram</b> in the dashboard and tap the link there.'
      );
      return ok();
    }

    if (cmd === '/stop') {
      await admin
        .from('user_preferences')
        .update({ telegram_alerts: false, telegram_chat_id: null, updated_at: new Date().toISOString() })
        .eq('telegram_chat_id', chatId);
      await reply('🔕 Alerts stopped for this chat. Reconnect any time from <b>Settings → Connect Telegram</b>.');
      return ok();
    }
  } catch (err: any) {
    console.error('[telegram webhook] update failed:', err.message);
    await reply('Sorry, something went wrong on our side. Please try again in a minute.');
  }

  return ok();
}
