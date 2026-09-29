-- ==============================================================================
-- Only the server may link a Telegram chat (2026-10-01)
--
-- Chats are linked through the bot: the user presses Start in Telegram and the webhook (service
-- role) stores that chat's id. The RLS policy on user_preferences lets users write their own row,
-- and the anon key is public, so without this a user could call Supabase directly and set
-- telegram_chat_id to someone else's chat, sending their alerts there.
--
-- Users (and the Settings "Disconnect" button) may still clear it: setting NULL is always allowed.
-- Idempotent: safe to re-run.
-- ==============================================================================

create or replace function public.guard_telegram_chat_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.telegram_chat_id is not null
     and (tg_op = 'INSERT' or new.telegram_chat_id is distinct from old.telegram_chat_id)
     and coalesce(auth.jwt() ->> 'role', '') in ('anon', 'authenticated')
  then
    raise exception 'telegram_chat_id can only be linked through the Telegram bot (Settings -> Connect Telegram)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists user_preferences_guard_telegram_chat_id on user_preferences;
create trigger user_preferences_guard_telegram_chat_id
  before insert or update of telegram_chat_id on user_preferences
  for each row execute function public.guard_telegram_chat_id();
