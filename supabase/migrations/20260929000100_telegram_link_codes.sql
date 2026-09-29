-- ==============================================================================
-- One-time codes for "Connect Telegram" (Settings -> Connect Telegram -> t.me/<bot>?start=<code>)
--
-- The web app issues a short-lived code; the bot's webhook receives "/start <code>" from the user's
-- private chat and stores that chat id in user_preferences. Users never type chat ids, and nobody can
-- point alerts at a chat they don't control.
--
-- Service-role only: RLS enabled with no policies, so neither anon nor authenticated clients can
-- read or write codes directly (the API routes use the service role).
-- ==============================================================================

create table if not exists telegram_link_codes (
  code text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_telegram_link_codes_user on telegram_link_codes (user_id);

alter table telegram_link_codes enable row level security;

-- Look up a user's preferences by chat id when the bot receives /stop
create index if not exists idx_user_preferences_telegram_chat
  on user_preferences (telegram_chat_id) where telegram_chat_id is not null;
