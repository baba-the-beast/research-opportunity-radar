create extension if not exists vector;
create extension if not exists pgcrypto; -- for gen_random_uuid()

-- One row per faculty member. MVP = exactly one row.
create table if not exists faculty_profile (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  institution text not null,
  department text,
  research_keywords text[] not null default '{}',  -- still drives journal_watch()'s search loop
  profile_text text not null,               -- free-text summary of research interests
  profile_embedding vector(384),            -- all-MiniLM-L6-v2 output dimension; backs the topic_similarity component
  min_relevance_band text not null default 'watch' check (min_relevance_band in ('high','strong','watch','low')),
  deadline_alert_window_days int not null default 30,
  alert_frequency text not null default 'weekly' check (alert_frequency in ('immediate','daily','weekly')),
  openalex_author_id text,
  orcid text,
  career_stage text not null default 'mid_career',
  phd_year int,
  institution_type text not null default 'tier1_research',
  citizenship_status text not null default 'citizen',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Weighted research vocabulary — the explainable backbone of scoring components
create table if not exists profile_terms (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references faculty_profile(id) on delete cascade,
  term text not null,
  term_type text not null check (term_type in ('topic','method','application','venue','funding_theme')),
  weight numeric(4,3) not null default 1.0 check (weight between 0 and 1),
  polarity text not null default 'positive' check (polarity in ('positive','negative')),
  source text not null default 'manual' check (source in ('manual','publication_seed')),
  created_at timestamptz not null default now(),
  unique (profile_id, term, term_type)
);

-- External source registry
create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('api','agency_page')),
  name text not null unique,                -- 'OpenAlex' | 'Crossref' | 'Semantic Scholar' | 'Grants.gov' | agency name
  base_url text not null,
  enabled boolean not null default true,
  health_status text not null default 'unknown' check (health_status in ('healthy','degraded','down','unknown')),
  created_at timestamptz not null default now()
);

-- Canonical opportunity. Deliberately holds NO deadline column
create table if not exists opportunities (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('journal','venue','funding')),
  title text not null,
  summary text,
  agency_or_publisher text,
  venue_name text,
  doi text,
  status text not null default 'unknown' check (status in ('open','forecasted','upcoming','closed','unknown')),
  fingerprint text not null unique,         -- multi-stage dedup key
  discovered_at timestamptz not null default now(),
  embedding vector(384),                    -- backs topic_similarity
  metadata jsonb                            -- original API response
);

-- Cross-source provenance.
create table if not exists opportunity_sources (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  source_id uuid not null references sources(id) on delete restrict,
  external_id text,
  source_url text not null,                 -- REQUIRED citation
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (opportunity_id, source_id)
);

-- Decoupled multi-deadline model.
create table if not exists opportunity_deadlines (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  deadline_type text not null check (deadline_type in ('submission','letter_of_intent','full_proposal','special_issue','event_start','other')),
  deadline_date date not null,
  timezone text not null default 'Asia/Kolkata',
  confidence text not null default 'unknown' check (confidence in ('confirmed','probable','unknown','closed','changed')),
  raw_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Append-only audit trail of every relevance computation.
create table if not exists scoring_log (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  faculty_id uuid not null references faculty_profile(id) on delete cascade,
  final_score numeric(5,2) not null check (final_score between 0 and 100),
  band text not null check (band in ('high','strong','watch','low','not_eligible')),
  components jsonb not null,
  matched_terms text[] not null default '{}',
  negative_matches text[] not null default '{}',
  model_version text not null default 'component-v1',
  scored_at timestamptz not null default now()
);

-- Dedup memory: alerts sent
create table if not exists alerts_sent (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  faculty_id uuid not null references faculty_profile(id) on delete cascade,
  channel text not null check (channel in ('dashboard','email','telegram')),
  alert_type text not null check (alert_type in ('new_high_relevance','deadline_critical','deadline_urgent','deadline_changed','weekly_digest')),
  dedupe_key text not null unique,
  sent_at timestamptz not null default now()
);

-- Faculty's own tracking state.
create table if not exists opportunity_status (
  opportunity_id uuid primary key references opportunities(id) on delete cascade,
  faculty_id uuid not null references faculty_profile(id) on delete cascade,
  status text not null default 'new' check (status in ('new','pursuing','dismissed')),
  updated_at timestamptz not null default now(),
  updated_by text not null default 'faculty'
);

-- One row per pipeline execution.
create table if not exists run_log (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','partial_failure','failed')),
  opportunities_found int not null default 0,
  opportunities_new int not null default 0,
  errors jsonb not null default '[]'
);

-- Per-source ingestion audit.
create table if not exists source_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references run_log(id) on delete cascade,
  source_id uuid not null references sources(id) on delete restrict,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','partial_failure','failed')),
  request_count int not null default 0,
  inserted_count int not null default 0,
  updated_count int not null default 0,
  error_count int not null default 0,
  error_category text check (error_category in ('timeout','rate_limited','auth','parse_error','unavailable', null)),
  latency_ms int
);

create index if not exists idx_opportunities_fingerprint on opportunities (fingerprint);
create index if not exists idx_opportunities_kind on opportunities (kind);
create index if not exists idx_opportunity_deadlines_date on opportunity_deadlines (deadline_date);
create index if not exists idx_opportunity_deadlines_opp on opportunity_deadlines (opportunity_id);
create index if not exists idx_opportunity_sources_opp on opportunity_sources (opportunity_id);
create index if not exists idx_scoring_log_opp on scoring_log (opportunity_id);
create index if not exists idx_source_runs_run on source_runs (run_id);

-- Faculty feedback loop for scoring tuning.
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  faculty_id uuid not null references faculty_profile(id) on delete cascade,
  rating text not null check (rating in ('relevant','not_relevant','neutral')),
  feedback_text text not null default '',
  negative_terms text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_feedback_opp on feedback (opportunity_id);
create index if not exists idx_feedback_rating on feedback (rating);
