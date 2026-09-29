-- ==============================================================================
-- Tenant isolation fixes (architecture review, 2026-09-28)
--
-- 1. The unassigned seed profile (faculty_profile.user_id is null) was readable by every
--    authenticated user, along with its terms, scores, feedback and tracking state.
-- 2. scoring_log is now written per faculty profile; users read only their own rows.
-- 3. chat_messages inserts must target a session the caller owns.
-- 4. alerts_sent never had RLS enabled, so the anon key could read and write it.
-- ==============================================================================

-- 1. Owner-only reads (drop the "or user_id is null" escape hatch)
drop policy if exists "faculty_profile_select_owner" on faculty_profile;
create policy "faculty_profile_select_owner"
  on faculty_profile for select
  to authenticated
  using (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'));

drop policy if exists "profile_terms_select_owner" on profile_terms;
create policy "profile_terms_select_owner"
  on profile_terms for select
  to authenticated
  using (
    profile_id in (select id from faculty_profile where user_id = auth.uid())
    or auth.jwt() ->> 'role' in ('admin', 'service_role')
  );

drop policy if exists "opportunity_status_select_owner" on opportunity_status;
create policy "opportunity_status_select_owner"
  on opportunity_status for select
  to authenticated
  using (
    faculty_id in (select id from faculty_profile where user_id = auth.uid())
    or auth.jwt() ->> 'role' in ('admin', 'service_role')
  );

drop policy if exists "feedback_select_owner" on feedback;
create policy "feedback_select_owner"
  on feedback for select
  to authenticated
  using (
    faculty_id in (select id from faculty_profile where user_id = auth.uid())
    or auth.jwt() ->> 'role' in ('admin', 'service_role')
  );

-- 2. Per-faculty scores
drop policy if exists "scoring_log_select_owner" on scoring_log;
create policy "scoring_log_select_owner"
  on scoring_log for select
  to authenticated
  using (
    faculty_id in (select id from faculty_profile where user_id = auth.uid())
    or auth.jwt() ->> 'role' in ('admin', 'service_role')
  );

-- Latest-score-per-faculty lookups (dashboard list + detail view)
create index if not exists idx_scoring_log_faculty_opp_scored
  on scoring_log (faculty_id, opportunity_id, scored_at desc);

-- 3. Chat messages: the session must belong to the caller, not just the user_id column
drop policy if exists "chat_messages_owner_all" on chat_messages;
create policy "chat_messages_owner_all"
  on chat_messages for all
  to authenticated
  using (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'))
  with check (
    (
      user_id = auth.uid()
      and session_id in (select id from chat_sessions where user_id = auth.uid())
    )
    or auth.jwt() ->> 'role' in ('admin', 'service_role')
  );

-- 4. alerts_sent: pipeline-only (service_role bypasses RLS; no client policies = deny)
alter table alerts_sent enable row level security;

-- Link profiles to auth users so deleting an account removes its profile (and, by cascade,
-- its terms, scores and feedback). NOT VALID skips checking legacy rows; run
-- `alter table faculty_profile validate constraint faculty_profile_user_id_fkey;` once clean.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'faculty_profile_user_id_fkey') then
    alter table faculty_profile
      add constraint faculty_profile_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade not valid;
  end if;
end $$;
