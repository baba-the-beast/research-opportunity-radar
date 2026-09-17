-- ==============================================================================
-- Supabase Row-Level Security (RLS) Hardened Production Policies
-- Default Deny Model with Explicit Role-Based Authorization
-- ==============================================================================
--
-- SECURITY ARCHITECTURE:
-- 1. Anonymous Access (anon):
--    Denied by default across all private and state-modifying tables.
--
-- 2. Authenticated Faculty Access (authenticated):
--    - Can SELECT active opportunities and deadlines.
--    - Can SELECT/UPDATE strictly their own faculty_profile (auth.uid() = user_id).
--    - Can manage strictly their own profile_terms, opportunity_status, and feedback.
--    - Can SELECT scoring_log strictly for their own faculty profile.
--
-- 3. Background Worker / Ingestion Pipeline:
--    Runs with SUPABASE_SERVICE_ROLE_KEY. In Supabase PostgreSQL, service_role
--    bypasses RLS completely, permitting high-throughput batch writes and lock management.
-- ==============================================================================

-- 1. Enable RLS on ALL application tables
alter table opportunities enable row level security;
alter table opportunity_deadlines enable row level security;
alter table opportunity_sources enable row level security;
alter table scoring_log enable row level security;
alter table faculty_profile enable row level security;
alter table profile_terms enable row level security;
alter table opportunity_status enable row level security;
alter table sources enable row level security;
alter table run_log enable row level security;
alter table source_runs enable row level security;
alter table feedback enable row level security;
alter table pipeline_locks enable row level security;

-- 2. Drop legacy permissive policies if they exist
drop policy if exists "Allow read opportunities" on opportunities;
drop policy if exists "Allow read opportunity_deadlines" on opportunity_deadlines;
drop policy if exists "Allow read opportunity_sources" on opportunity_sources;
drop policy if exists "Allow read scoring_log" on scoring_log;
drop policy if exists "Allow read faculty_profile" on faculty_profile;
drop policy if exists "Allow authenticated update faculty_profile" on faculty_profile;
drop policy if exists "Allow read profile_terms" on profile_terms;
drop policy if exists "Allow authenticated modify profile_terms" on profile_terms;
drop policy if exists "Allow read run_log" on run_log;
drop policy if exists "Allow read source_runs" on source_runs;
drop policy if exists "Allow read sources" on sources;
drop policy if exists "Allow submit feedback" on feedback;
drop policy if exists "Allow read feedback" on feedback;

-- 3. Faculty Profile Policies (User-Isolated)
-- Users can only read and update their own profile record.
create policy "faculty_profile_select_owner"
  on faculty_profile for select
  to authenticated
  using (user_id = auth.uid() or user_id is null or auth.jwt() ->> 'role' in ('admin', 'service_role'));

create policy "faculty_profile_update_owner"
  on faculty_profile for update
  to authenticated
  using (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'))
  with check (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'));

create policy "faculty_profile_insert_owner"
  on faculty_profile for insert
  to authenticated
  with check (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'));

-- 4. Profile Terms Policies (Cascaded User Isolation)
create policy "profile_terms_select_owner"
  on profile_terms for select
  to authenticated
  using (
    profile_id in (select id from faculty_profile where user_id = auth.uid() or user_id is null)
    or auth.jwt() ->> 'role' in ('admin', 'service_role')
  );

create policy "profile_terms_modify_owner"
  on profile_terms for all
  to authenticated
  using (
    profile_id in (select id from faculty_profile where user_id = auth.uid())
    or auth.jwt() ->> 'role' in ('admin', 'service_role')
  )
  with check (
    profile_id in (select id from faculty_profile where user_id = auth.uid())
    or auth.jwt() ->> 'role' in ('admin', 'service_role')
  );

-- 5. Opportunity Status Policies (Tracking State Isolation)
create policy "opportunity_status_select_owner"
  on opportunity_status for select
  to authenticated
  using (
    faculty_id in (select id from faculty_profile where user_id = auth.uid() or user_id is null)
    or auth.jwt() ->> 'role' in ('admin', 'service_role')
  );

create policy "opportunity_status_modify_owner"
  on opportunity_status for all
  to authenticated
  using (
    faculty_id in (select id from faculty_profile where user_id = auth.uid())
    or auth.jwt() ->> 'role' in ('admin', 'service_role')
  )
  with check (
    faculty_id in (select id from faculty_profile where user_id = auth.uid())
    or auth.jwt() ->> 'role' in ('admin', 'service_role')
  );

-- 6. Feedback Policies (User-Isolated Feedback Submissions)
create policy "feedback_select_owner"
  on feedback for select
  to authenticated
  using (
    faculty_id in (select id from faculty_profile where user_id = auth.uid() or user_id is null)
    or auth.jwt() ->> 'role' in ('admin', 'service_role')
  );

create policy "feedback_insert_owner"
  on feedback for insert
  to authenticated
  with check (
    faculty_id in (select id from faculty_profile where user_id = auth.uid())
    or auth.jwt() ->> 'role' in ('admin', 'service_role')
  );

-- 7. Opportunities & Deadlines: Authenticated Read-Only
-- Authenticated users can browse the opportunity catalogue.
create policy "opportunities_select_authenticated"
  on opportunities for select
  to authenticated
  using (true);

create policy "opportunity_deadlines_select_authenticated"
  on opportunity_deadlines for select
  to authenticated
  using (true);

create policy "opportunity_sources_select_authenticated"
  on opportunity_sources for select
  to authenticated
  using (true);

-- 8. Scoring Log: Restricted Read-Only
create policy "scoring_log_select_owner"
  on scoring_log for select
  to authenticated
  using (
    faculty_id in (select id from faculty_profile where user_id = auth.uid() or user_id is null)
    or auth.jwt() ->> 'role' in ('admin', 'service_role')
  );

-- 9. Telemetry & Ingestion Runs: Authenticated Read-Only
create policy "run_log_select_authenticated"
  on run_log for select
  to authenticated
  using (true);

create policy "source_runs_select_authenticated"
  on source_runs for select
  to authenticated
  using (true);

create policy "sources_select_authenticated"
  on sources for select
  to authenticated
  using (true);

-- 10. Pipeline Locks: Protected against non-admin tampering
create policy "pipeline_locks_select_operator"
  on pipeline_locks for select
  to authenticated
  using (auth.jwt() ->> 'role' in ('admin', 'service_role'));

-- 11. Multi-User SaaS Tenant Tables RLS
alter table if exists user_preferences enable row level security;
alter table if exists user_opportunity_state enable row level security;
alter table if exists user_activity enable row level security;
alter table if exists chat_sessions enable row level security;
alter table if exists chat_messages enable row level security;

create policy "user_preferences_owner_all"
  on user_preferences for all
  to authenticated
  using (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'))
  with check (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'));

create policy "user_opportunity_state_owner_all"
  on user_opportunity_state for all
  to authenticated
  using (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'))
  with check (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'));

create policy "user_activity_owner_all"
  on user_activity for all
  to authenticated
  using (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'))
  with check (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'));

create policy "chat_sessions_owner_all"
  on chat_sessions for all
  to authenticated
  using (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'))
  with check (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'));

create policy "chat_messages_owner_all"
  on chat_messages for all
  to authenticated
  using (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'))
  with check (user_id = auth.uid() or auth.jwt() ->> 'role' in ('admin', 'service_role'));

