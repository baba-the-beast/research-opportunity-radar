-- ==============================================================================
-- Research Opportunity Radar — Multi-User SaaS Schema & RLS Policies
-- Enables strict per-user data isolation, personal scoring, preferences,
-- saved opportunities, audit trails, and persistent AI Copilot chat sessions.
-- ==============================================================================

-- 1. Ensure required extensions exist
create extension if not exists pgcrypto;
create extension if not exists vector;

-- ------------------------------------------------------------------------------
-- 2. USER PREFERENCES
-- Stores per-user dashboard preferences, UI theme, score thresholds, and alert channels.
-- ------------------------------------------------------------------------------
create table if not exists user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  min_score int not null default 50 check (min_score between 0 and 100),
  email_alerts boolean not null default true,
  telegram_alerts boolean not null default false,
  telegram_chat_id text,
  digest_frequency text not null default 'weekly' check (digest_frequency in ('daily', 'weekly', 'never')),
  auto_summarize boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------------------
-- 3. USER OPPORTUNITY STATE (Personalized Tracking & Bookmarking)
-- Decouples global canonical opportunities from individual researcher state.
-- Compound unique key (user_id, opportunity_id) guarantees zero cross-user collisions.
-- ------------------------------------------------------------------------------
create table if not exists user_opportunity_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  status text not null default 'new' check (status in ('new', 'pursuing', 'dismissed', 'applied')),
  saved boolean not null default false,
  personal_score numeric(5,2) check (personal_score between 0 and 100 or personal_score is null),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_user_opportunity unique (user_id, opportunity_id)
);

create index if not exists idx_user_opp_lookup on user_opportunity_state (user_id, opportunity_id);
create index if not exists idx_user_opp_saved on user_opportunity_state (user_id, saved) where saved = true;
create index if not exists idx_user_opp_status on user_opportunity_state (user_id, status);

-- ------------------------------------------------------------------------------
-- 4. USER ACTIVITY AUDIT TRAIL
-- Immutable chronological record of user actions (saved items, status changes, searches).
-- ------------------------------------------------------------------------------
create table if not exists user_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in (
    'login', 'logout', 'saved_opportunity', 'unsaved_opportunity',
    'status_change', 'profile_update', 'preferences_update',
    'chat_message', 'copilot_tool_executed', 'export_calendar'
  )),
  title text not null,
  description text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_user_activity_user on user_activity (user_id, created_at desc);

-- ------------------------------------------------------------------------------
-- 5. AI RESEARCH COPILOT SESSIONS & MESSAGES
-- Multi-tenant persistent conversation memory with tool execution history.
-- ------------------------------------------------------------------------------
create table if not exists chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Research Consultation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_chat_sessions_user on chat_sessions (user_id, updated_at desc);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null,
  tool_calls jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_messages_session on chat_messages (session_id, created_at asc);
create index if not exists idx_chat_messages_user on chat_messages (user_id);

-- ------------------------------------------------------------------------------
-- 6. FACULTY PROFILE MULTI-TENANT UPGRADE
-- Ensure faculty_profile supports one profile per authenticated user
-- ------------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'uq_faculty_profile_user_id'
  ) then
    create unique index if not exists idx_unique_faculty_profile_user_id
      on faculty_profile (user_id)
      where user_id is not null;
  end if;
end $$;

-- ------------------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY (RLS) POLICIES
-- Default-Deny with Strict auth.uid() Ownership
-- ------------------------------------------------------------------------------

-- Enable RLS on all newly introduced multi-tenant tables
alter table user_preferences enable row level security;
alter table user_opportunity_state enable row level security;
alter table user_activity enable row level security;
alter table chat_sessions enable row level security;
alter table chat_messages enable row level security;

-- Drop any previous policies on these tables
drop policy if exists "user_preferences_owner_all" on user_preferences;
drop policy if exists "user_opportunity_state_owner_all" on user_opportunity_state;
drop policy if exists "user_activity_owner_all" on user_activity;
drop policy if exists "chat_sessions_owner_all" on chat_sessions;
drop policy if exists "chat_messages_owner_all" on chat_messages;

-- A. User Preferences: Users can manage strictly their own preferences
drop policy if exists "user_preferences_owner_all" on user_preferences;
create policy "user_preferences_owner_all"
  on user_preferences for all
  to authenticated
  using (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'))
  with check (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'));

-- B. User Opportunity State: Strict per-user tracking & bookmark isolation
drop policy if exists "user_opportunity_state_owner_all" on user_opportunity_state;
create policy "user_opportunity_state_owner_all"
  on user_opportunity_state for all
  to authenticated
  using (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'))
  with check (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'));

-- C. User Activity: Users can only read and append to their own activity log
drop policy if exists "user_activity_owner_all" on user_activity;
create policy "user_activity_owner_all"
  on user_activity for all
  to authenticated
  using (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'))
  with check (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'));

-- D. Chat Sessions: Strict per-user AI conversation isolation
drop policy if exists "chat_sessions_owner_all" on chat_sessions;
create policy "chat_sessions_owner_all"
  on chat_sessions for all
  to authenticated
  using (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'))
  with check (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'));

-- E. Chat Messages: Strict per-user AI message isolation
drop policy if exists "chat_messages_owner_all" on chat_messages;
create policy "chat_messages_owner_all"
  on chat_messages for all
  to authenticated
  using (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'))
  with check (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'));
