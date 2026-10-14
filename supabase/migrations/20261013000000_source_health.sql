-- What each source returned on each run, so a source that breaks quietly (a site redesign that
-- leaves the scraper reading an empty page) is caught by comparing with its recent runs.
create table if not exists source_health (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references run_log(id) on delete cascade,
  source_name text not null,
  checked_at timestamptz not null default now(),
  listed_count int not null default 0,  -- calls the source listed (before closed/result filtering)
  kept_count int not null default 0,    -- calls kept as current opportunities
  error text,
  latency_ms int
);

create index if not exists idx_source_health_source_checked on source_health (source_name, checked_at desc);

alter table source_health enable row level security;

-- Readable like run_log / source_runs (Activity page); only the pipeline (service role) writes
drop policy if exists "source_health_select_authenticated" on source_health;
create policy "source_health_select_authenticated"
  on source_health for select
  to authenticated
  using (true);
