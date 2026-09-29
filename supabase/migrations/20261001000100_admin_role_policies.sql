-- ==============================================================================
-- Admin access in RLS policies reads app_metadata.role (2026-10-01)
--
-- Earlier policies granted admins access with `auth.jwt() ->> 'role' in ('admin', 'service_role')`.
-- The top-level `role` claim of a Supabase user JWT is always 'authenticated' (or 'anon'), so the
-- admin branch never matched; and the service role bypasses RLS entirely, so its branch was never
-- needed. Admin/operator roles are set by the server in app_metadata (users cannot edit it; see
-- web/lib/auth.ts), which is what these policies now check.
--
-- Chat sessions/messages and the activity log stay strictly owner-only: admins do not need to read
-- users' private conversations.
--
-- Every affected policy is recreated in its latest form (including the tenant-isolation fixes of
-- 20260928000000). Idempotent: safe to re-run.
-- ==============================================================================

-- Server-controlled role from the caller's JWT. `set search_path = ''` + fully qualified names keep
-- it safe to call from policies; wrapped in (select ...) below so Postgres evaluates it once per
-- query instead of once per row.
create or replace function public.app_role()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '')
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.app_role() = 'admin'
$$;

revoke all on function public.app_role() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.app_role() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ------------------------------------------------------------------------------
-- faculty_profile
-- ------------------------------------------------------------------------------
drop policy if exists "faculty_profile_select_owner" on faculty_profile;
create policy "faculty_profile_select_owner"
  on faculty_profile for select
  to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "faculty_profile_update_owner" on faculty_profile;
create policy "faculty_profile_update_owner"
  on faculty_profile for update
  to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()))
  with check (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "faculty_profile_insert_owner" on faculty_profile;
create policy "faculty_profile_insert_owner"
  on faculty_profile for insert
  to authenticated
  with check (user_id = (select auth.uid()) or (select public.is_admin()));

-- ------------------------------------------------------------------------------
-- Tables owned through a faculty profile
-- ------------------------------------------------------------------------------
drop policy if exists "profile_terms_select_owner" on profile_terms;
create policy "profile_terms_select_owner"
  on profile_terms for select
  to authenticated
  using (
    profile_id in (select id from faculty_profile where user_id = (select auth.uid()))
    or (select public.is_admin())
  );

drop policy if exists "profile_terms_modify_owner" on profile_terms;
create policy "profile_terms_modify_owner"
  on profile_terms for all
  to authenticated
  using (
    profile_id in (select id from faculty_profile where user_id = (select auth.uid()))
    or (select public.is_admin())
  )
  with check (
    profile_id in (select id from faculty_profile where user_id = (select auth.uid()))
    or (select public.is_admin())
  );

drop policy if exists "opportunity_status_select_owner" on opportunity_status;
create policy "opportunity_status_select_owner"
  on opportunity_status for select
  to authenticated
  using (
    faculty_id in (select id from faculty_profile where user_id = (select auth.uid()))
    or (select public.is_admin())
  );

drop policy if exists "opportunity_status_modify_owner" on opportunity_status;
create policy "opportunity_status_modify_owner"
  on opportunity_status for all
  to authenticated
  using (
    faculty_id in (select id from faculty_profile where user_id = (select auth.uid()))
    or (select public.is_admin())
  )
  with check (
    faculty_id in (select id from faculty_profile where user_id = (select auth.uid()))
    or (select public.is_admin())
  );

drop policy if exists "feedback_select_owner" on feedback;
create policy "feedback_select_owner"
  on feedback for select
  to authenticated
  using (
    faculty_id in (select id from faculty_profile where user_id = (select auth.uid()))
    or (select public.is_admin())
  );

drop policy if exists "feedback_insert_owner" on feedback;
create policy "feedback_insert_owner"
  on feedback for insert
  to authenticated
  with check (
    faculty_id in (select id from faculty_profile where user_id = (select auth.uid()))
    or (select public.is_admin())
  );

drop policy if exists "scoring_log_select_owner" on scoring_log;
create policy "scoring_log_select_owner"
  on scoring_log for select
  to authenticated
  using (
    faculty_id in (select id from faculty_profile where user_id = (select auth.uid()))
    or (select public.is_admin())
  );

-- ------------------------------------------------------------------------------
-- Pipeline lock: operators and admins may see whether a run is active
-- ------------------------------------------------------------------------------
drop policy if exists "pipeline_locks_select_operator" on pipeline_locks;
create policy "pipeline_locks_select_operator"
  on pipeline_locks for select
  to authenticated
  using ((select public.app_role()) in ('admin', 'operator'));

-- ------------------------------------------------------------------------------
-- Per-user tables
-- ------------------------------------------------------------------------------
drop policy if exists "user_preferences_owner_all" on user_preferences;
create policy "user_preferences_owner_all"
  on user_preferences for all
  to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()))
  with check (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "user_opportunity_state_owner_all" on user_opportunity_state;
create policy "user_opportunity_state_owner_all"
  on user_opportunity_state for all
  to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()))
  with check (user_id = (select auth.uid()) or (select public.is_admin()));

-- Private to the user: no admin branch
drop policy if exists "user_activity_owner_all" on user_activity;
create policy "user_activity_owner_all"
  on user_activity for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "chat_sessions_owner_all" on chat_sessions;
create policy "chat_sessions_owner_all"
  on chat_sessions for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "chat_messages_owner_all" on chat_messages;
create policy "chat_messages_owner_all"
  on chat_messages for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and session_id in (select id from chat_sessions where user_id = (select auth.uid()))
  );
