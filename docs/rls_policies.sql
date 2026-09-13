-- ==============================================================================
-- Supabase Row-Level Security (RLS) Production Policies
-- ==============================================================================
--
-- ARCHITECTURE NOTE:
-- 1. Backend Orchestrator:
--    The automated pipeline runs with SUPABASE_SERVICE_ROLE_KEY.
--    In Supabase PostgreSQL, the service_role key bypasses RLS completely,
--    allowing unrestricted ingestion, deduplication, scoring logs, and upserts.
--
-- 2. Web Dashboard & API Routes:
--    When deployed with SUPABASE_ANON_KEY, the frontend has least-privilege
--    read access for public dashboard views, can record feedback, and restricts
--    profile modifications to authenticated administrators.
-- ==============================================================================

-- 1. Enable RLS on all tables
alter table opportunities enable row level security;
alter table opportunity_deadlines enable row level security;
alter table opportunity_sources enable row level security;
alter table scoring_log enable row level security;
alter table faculty_profile enable row level security;
alter table profile_terms enable row level security;
alter table sources enable row level security;
alter table run_log enable row level security;
alter table source_runs enable row level security;
alter table feedback enable row level security;

-- 2. Opportunities & Scoring: Read-only for anon and authenticated
create policy "Allow read opportunities"
  on opportunities for select
  to anon, authenticated
  using (true);

create policy "Allow read opportunity_deadlines"
  on opportunity_deadlines for select
  to anon, authenticated
  using (true);

create policy "Allow read opportunity_sources"
  on opportunity_sources for select
  to anon, authenticated
  using (true);

create policy "Allow read scoring_log"
  on scoring_log for select
  to anon, authenticated
  using (true);

-- 3. Telemetry & Source Runs: Read-only for anon and authenticated
create policy "Allow read run_log"
  on run_log for select
  to anon, authenticated
  using (true);

create policy "Allow read source_runs"
  on source_runs for select
  to anon, authenticated
  using (true);

create policy "Allow read sources"
  on sources for select
  to anon, authenticated
  using (true);

-- 4. Faculty Profiles & Terms: Read-only for anon, write restricted to authenticated
create policy "Allow read faculty_profile"
  on faculty_profile for select
  to anon, authenticated
  using (true);

create policy "Allow authenticated update faculty_profile"
  on faculty_profile for update
  to authenticated
  using (true)
  with check (true);

create policy "Allow read profile_terms"
  on profile_terms for select
  to anon, authenticated
  using (true);

create policy "Allow authenticated modify profile_terms"
  on profile_terms for all
  to authenticated
  using (true)
  with check (true);

-- 5. Feedback Loop: Anonymous users can submit relevance ratings
create policy "Allow submit feedback"
  on feedback for insert
  to anon, authenticated
  with check (true);

create policy "Allow read feedback"
  on feedback for select
  to anon, authenticated
  using (true);
