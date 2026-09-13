# Research Opportunity Radar — End-to-End Build Specification
**AURA Track 3 · Faculty owner: Vibha, COEP**
Version 1.1 — prepared as a build-ready spec for implementation with AI coding tools in VS Code.

**Changelog from v1.0:** Section 6 was substantially upgraded after a comparative review: the single opaque cosine-similarity score was replaced with a transparent, weighted, component-based scorer with explicit bands and a full explanation object (6.2); a single `deadline_date` column was replaced with a decoupled `opportunity_deadlines` table carrying per-date confidence states (6.4); single-hash dedup was replaced with a five-stage matching hierarchy and a proper `fingerprint` (6.3); and a single global `run_log` was supplemented with per-source `source_runs` plus cross-source `opportunity_sources` provenance, so ingestion health and citation history are both auditable at the source level, not just the pipeline level (6.1). Every downstream section (7–17) was updated to match — there is no part of this document still describing the v1.0 mechanics.

---

## 0. How to use this document

This file is written to be dropped into the root of your repository as `SPEC.md` and used as the **single source of truth** while you build with an AI coding assistant in VS Code (you mentioned "Omniroute" — this spec assumes you mean **OpenRouter** (openrouter.ai), used as the model-provider backend for a VS Code AI coding extension such as Cline, Roo Code, or Continue; if you meant something else, everything below is provider-agnostic and works the same way — just point the extension at whichever model endpoint you're using).

Rules for using this with an AI tool, so nothing goes wrong mid-build:

1. **Work phase by phase, in order.** Section 12 breaks the whole build into 14 phases. Do not ask the AI tool to "build the whole app" in one shot — it will skip details and you'll lose the precision this document gives you.
2. **Paste the phase's exact prompt, not a summary.** Each phase in Section 12 has a ready-to-paste prompt block. Copy it verbatim into your AI tool, with `SPEC.md` open/attached as context if your tool supports attaching files.
3. **Do not move to the next phase until the "Definition of Done" checklist for the current phase passes.** This is what prevents bugs from compounding across phases.
4. **Never let the AI tool invent an API, table name, or file path that isn't in this document.** If it suggests one, redirect it back to the spec. Consistency between phases is what keeps the system bug-free.
5. Keep this file itself in version control and update it if you deviate from it — a spec that drifts from the code is worse than no spec.

---

## 1. Project brief (restated for completeness)

- **Scenario:** New journals and funding opportunities are currently found by manually searching. There is no standing system watching for new venues or proposal deadlines and surfacing that information before it's too late.
- **Datasets:** OpenAlex, Crossref, and Semantic Scholar for journal/venue metadata; funding-agency deadline pages as a secondary source.
- **Tools:** `journal_watch(field)`, `funding_deadline_scan(agency_list)`, `relevance_score(opportunity, faculty_profile)`.
- **Skill:** An opportunity-radar method — relevance scoring against a faculty member's research profile, deadline-proximity alerting.
- **Memory:** Faculty research-profile memory informing relevance scoring; memory of opportunities already surfaced, to avoid repeat alerts.
- **Connector (MCP):** MCP connector to the scholarly-metadata APIs and a deadline-tracking calendar.
- **Orchestration:** A standing loop — Watch → Score → Validate → Alert — re-triggered on a schedule rather than only on request.
- **Governance:** Alerts are informational only; no proposal is auto-started from an alert without faculty opting in; every alert cites its source.
- **Deliverable:** Weekly opportunity digest sample, relevance-scoring log, proposal-deadline calendar, reusable prompt command.

Everything below is designed so that each brief line above maps to a concrete, buildable, free-to-run piece of the system. Section 16 gives the exact mapping back to this list.

---

## 2. Goals, non-goals, and definition of done

**Goals**
- A pipeline that runs on a schedule (no manual triggering required) and finds new journals/venues and funding calls relevant to one faculty member's research profile.
- A scoring system that ranks each opportunity by fit, using free, local, no-API-key ML — not a paid LLM call per item.
- A dashboard where the faculty member can see the radar feed, deadlines, and history.
- A calendar feed of proposal deadlines that can be subscribed to from Google/Outlook/Apple Calendar.
- Zero recurring cost. Every component must run on a free tier or be entirely free/open-source.

**Non-goals (explicitly out of scope, to keep governance intact)**
- The system never submits, drafts, or auto-starts a proposal. It only ever informs.
- The system does not scrape login-walled or paywalled agency portals.
- The system is single-faculty in this version (one `faculty_profile` row). Multi-tenant support is a possible v2, not part of this build.

**Definition of done for the whole project**
1. A scheduled GitHub Actions run completes successfully end to end at least twice, on two different days, with zero unhandled exceptions.
2. The dashboard shows at least 10 real opportunities pulled from live APIs, each with a visible source citation link.
3. The `/calendar.ics` feed opens correctly in Google Calendar and shows at least one dated deadline.
4. Re-running the pipeline twice in a row does not create duplicate opportunity rows (the fingerprint-based dedup hierarchy in Section 6.3 works, including across sources reporting the same item).
5. All automated tests in Section 13 pass in CI.
6. The four deliverables in Section 16 exist as actual files/pages, not just described.

---

## 3. Chosen tech stack and why

| Layer | Choice | Why | Cost |
|---|---|---|---|
| Ingestion + scoring pipeline | Python 3.11, run as a script | Best library support for `sentence-transformers`; matches the scholarly-API ecosystem | Free |
| Orchestration/scheduler | GitHub Actions (`schedule` + `workflow_dispatch`) | No server to keep alive; genuinely free and reliable if the repo is **public** (see §7.4) | Free |
| Database | Supabase (managed Postgres + pgvector) | Free Postgres with a vector column type for embeddings, generous free tier, dashboard for manual inspection | Free (500 MB DB, 1 GB storage, 5 GB egress) |
| App backend (reads/writes for the UI) | Next.js API Routes (TypeScript), deployed on Vercel | Serverless, no cold-server-sleep problem the way Render has; one deployment for frontend + backend | Free |
| Frontend | Next.js (App Router) + Tailwind CSS, fully custom design tokens | See Section 9 — deliberately not a generic AI-dashboard look | Free |
| Relevance scoring | `sentence-transformers` `all-MiniLM-L6-v2` (topic-similarity component only) + a deterministic weighted-term scorer for the other six components, per Section 6.2 | 90 MB model, CPU-only, Apache-2.0, no API key, no per-call cost, no rate limit; the component wrapper adds zero external dependencies | Free |
| Deduplication | `rapidfuzz` for the bounded fuzzy-match stage in Section 6.3 | Pure-Python/C++ string-distance library, MIT license, no network calls | Free |
| Calendar | Self-generated `.ics` file, hosted on Supabase Storage, no OAuth | Avoids Google Calendar API OAuth complexity entirely while still giving a subscribable calendar | Free |
| Notifications | Telegram Bot API (primary) and/or Brevo transactional email (secondary) | Telegram bot tokens are free and unlimited for personal use; Brevo gives 300 free emails/day if email is preferred | Free |
| Agent/tool exposure | MCP server (`mcp` Python SDK, official Anthropic-published open-source SDK) | Directly satisfies the brief's "Connector (MCP)" line — lets any MCP-capable chat client call the same tools conversationally | Free |
| Testing | pytest + responses (Python), Vitest + React Testing Library + Playwright (frontend) | Industry-standard, free, well-documented | Free |

**A note on why not Streamlit / a generic AI-dashboard template:** you explicitly asked for a frontend that reads as hand-crafted rather than templated. Streamlit is excellent for internal data tools but its visual vocabulary (sidebar + st.metric cards) is the single most recognizable "AI project demo" look. Section 9 gives you a real design system instead.

---

## 4. Free data sources — exact, current details

APIs and their free-tier terms change. The details below were verified as current in **September 2026**; if you hit an auth error that contradicts this table, check the linked docs page before assuming your code is wrong.

### 4.1 OpenAlex (journal/venue/author metadata)
- **Important change:** as of **13 February 2026**, OpenAlex requires an API key for all requests — the old "polite pool via `mailto`" system is retired.
- Getting a key is free and takes under a minute: create an account at `openalex.org`, then copy your key from `openalex.org/settings/api`.
- A free key gives you **$1 of free usage per day** (~100,000 credits/day). Without a key you get $0.10/day (100 credits — testing only, not enough for a scheduled pipeline).
- Credit costs (approximate, per current docs): a single-entity lookup by ID/DOI = 1 credit (effectively unlimited for our use); a filtered list call = 10 credits; a `search=` call = higher cost but still ~1,000 searches/day within the free budget.
- Base URL: `https://api.openalex.org`. Add `api_key=<KEY>` as a query parameter on every call.
- We use it for: discovering venues/journals by concept/topic (`/works?search=<field>&filter=...`), and optionally resolving the faculty member's own OpenAlex author ID for citation-network context.
- Docs: `https://developers.openalex.org`.

### 4.2 Crossref (journal/venue/funder metadata)
- Still fully free, **no API key required**, unauthenticated access works.
- Add a `mailto=<your email>` query parameter (or a `mailto:` in your `User-Agent` header) to be routed to the faster "polite pool." This is optional but strongly recommended — it does not require signup, just an email string.
- Base URL: `https://api.crossref.org`. Example: `GET /works?query=<field>&mailto=<email>&rows=25`.
- Docs: `https://github.com/CrossRef/rest-api-doc`.

### 4.3 Semantic Scholar (citation graph / paper recommendations)
- Free without any key, but unauthenticated calls share a global pool that can be throttled under heavy worldwide load. Treat unauthenticated use conservatively (roughly 1 request/second, with backoff on HTTP 429).
- A free API key is available on request at `https://www.semanticscholar.org/product/api` — it gives you a dedicated (not shared) rate-limit budget, starting conservatively and increasable by request. Use it if you can; the pipeline works without it, just more slowly.
- Base URL: `https://api.semanticscholar.org/graph/v1`.
- We use it for: enriching an opportunity with related-paper context, and (optionally) matching the faculty profile against Semantic Scholar's own paper/author recommendation endpoints.

### 4.4 Grants.gov (funding opportunities — US federal, used as the reference implementation)
- Fully free, **no API key**, no signup, for the public search endpoint.
- `POST https://api.grants.gov/v1/api/search2` with a JSON body, e.g. `{"keyword": "graph neural networks", "oppStatuses": "posted|forecasted", "rows": 50, "startRecordNum": 0}`.
- Returns `data.hitCount` and `data.oppHits[]` with opportunity ID, title, agency code, open/close dates, and status.
- This is the concrete, working example agency adapter. Because COEP is an Indian institution, Grants.gov alone is not sufficient — see §4.5.

### 4.5 Indian and other funding agencies & live scholarly feeds
The system includes production agency adapters implementing the `AgencyAdapter` interface:
- **ICMR Adapter (`ICMRAdapter`)**: Scrapes the Indian Council of Medical Research (`https://www.icmr.gov.in/call-for-proposals`), extracting biomedical/health calls, absolute links, and proposal deadlines from the live DOM table.
- **DBT Adapter (`DBTAdapter`)**: Consumes the Department of Biotechnology India structured JSON endpoint (`https://dbt.gov.in/data-view?name=call-for-proposals`), parsing active biotechnology calls and submission deadlines.
- **DST-SERB Adapter (`ExampleIndianAgencyAdapter`)**: Scrapes DST-SERB proposal notices (`https://dst.gov.in/call-for-proposals`).
- **NSF Funding Solicitations RSS Feed**: Direct live XML ingestion from `https://www.nsf.gov/rss/rss_www_funding.xml`.
- **WikiCFP Conference & Special Issue Search**: Direct live HTML harvest from `http://www.wikicfp.com/cfp/servlet/tool.search`.

### 4.6 Embeddings for relevance scoring
- `sentence-transformers/all-MiniLM-L6-v2` — free, MIT/Apache-2.0-licensed, runs entirely on CPU, ~90 MB download (cached after first run). No API key, no per-call cost, no external network dependency once downloaded. This is what powers `relevance_score()`.

### 4.7 Summary table of data sources & auth requirements

| Source | Type | Key needed? | Where to get it | Rate Limit / Politeness |
|---|---|---|---|---|
| OpenAlex | Scholarly Works & Citations | **Yes**, as of Feb 2026 | openalex.org/settings/api | 5 req/sec limiter (auto polite pool if mailto) |
| Crossref | Academic DOIs & Metadata | No (optional `mailto`) | n/a | 5 req/sec limiter |
| Semantic Scholar | Papers & Recommendation Graph | Optional (recommended) | semanticscholar.org/product/api | 1 req/sec default |
| Grants.gov | US Federal Solicitations | No | n/a | 3 req/sec limiter |
| ICMR | Indian Health Research RFPs | No (public web) | icmr.gov.in | 2 req/sec scraper limiter |
| DBT India | Indian Biotech RFPs | No (public web / JSON) | dbt.gov.in | 2 req/sec scraper limiter |
| DST-SERB | Indian S&T Solicitations | No (public web) | dst.gov.in | 2 req/sec scraper limiter |
| NSF Solicitations | Federal Research Calls | No (RSS XML) | nsf.gov/rss | 2 req/sec scraper limiter |
| WikiCFP | Conference CFPs & Special Issues | No (HTTP Query) | wikicfp.com | 2 req/sec scraper limiter |
| Supabase | Database & Storage | Yes (URL + key) | supabase.com | Standard free tier |
| Telegram Bot | High-Priority Alerts | Yes (bot token) | @BotFather in Telegram | Free |
| Brevo (email) | Transactional Digests | Optional | brevo.com | Free (300 emails/day) |


---

## 5. High-level architecture

```
                         ┌───────────────────────────────────────────┐
                         │   GitHub Actions (public repo, free,      │
                         │   cron: Mon & Thu, + manual dispatch)     │
                         │                                           │
                         │   Python pipeline:                        │
                         │   journal_watch → funding_deadline_scan   │
                         │        → relevance_score → governance     │
                         │        validate → write DB → notify       │
                         └───────────────┬───────────────────────────┘
                                         │ writes (service-role key)
                                         ▼
                         ┌───────────────────────────────────────────┐
                         │   Supabase (managed Postgres + pgvector   │
                         │   + Storage for the .ics calendar file)   │
                         └───────────────┬───────────────────────────┘
                                         │ reads/writes (service-role key,
                                         │ server-side only)
                                         ▼
                         ┌───────────────────────────────────────────┐
                         │  Next.js app (Vercel, free tier)          │
                         │  - API routes = the only thing that talks │
                         │    to Supabase                             │
                         │  - Server-rendered dashboard pages         │
                         └───────────────┬───────────────────────────┘
                                         │ HTTPS
                                         ▼
                                  ┌─────────────┐
                                  │   Browser    │
                                  └─────────────┘

     Parallel, optional access path:
                         ┌───────────────────────────────────────────┐
                         │  mcp_server.py (same tools as the pipeline)│
                         │  exposed over MCP to any MCP-capable       │
                         │  client (Claude Desktop, your VS Code AI   │
                         │  extension, etc.) for conversational use   │
                         └───────────────────────────────────────────┘
```

Key architectural decisions and their reasons:
- **The browser never talks to Supabase directly.** Only server-side code (Next.js API routes, and the Python pipeline) holds the Supabase service-role key. This avoids Row Level Security complexity entirely for a single-user tool while still keeping the key off the client.
- **The pipeline is a script, not a server.** There is nothing "always on" to pay for or that can crash and stay down. GitHub Actions runs it, records the outcome in `run_log`, and exits.
- **The calendar is a static file, not a live API.** The Python pipeline regenerates `deadlines.ics` on every run and uploads it to a public Supabase Storage bucket. The frontend just links to that URL. No duplicate ICS logic in two languages, no OAuth.

---

## 6. Database schema, scoring algorithm, deduplication, and deadline engine

This section was upgraded from v1.0 after a side-by-side review against a second planning document (internally referred to as "Document 1"). Four structural weaknesses in the v1.0 design were replaced outright rather than patched: a single opaque embedding score, one deadline column per opportunity, a single-hash dedup check, and a pipeline-level-only run log with no per-source visibility. Everything in this section is what the rest of the spec now builds against — Sections 7–13 have been updated to match.

### 6.1 Tables

Run this once against your Supabase project (SQL Editor → New query). Enable the `vector` extension first (Supabase free tier includes `pgvector`).

```sql
create extension if not exists vector;
create extension if not exists pgcrypto; -- for gen_random_uuid()

-- One row per faculty member. MVP = exactly one row.
create table faculty_profile (
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
  career_stage text not null default 'Assistant Professor',
  phd_year int default 2021,
  institution_type text not null default 'R1 Doctoral University (IHE)',
  citizenship_status text not null default 'US Citizen or Permanent Resident',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Weighted research vocabulary — the explainable backbone of scoring components
-- 2 (exact_term_match), 3 (method_match), 4 (application_match), and 5 (venue_fit).
-- Replaces a flat keyword array with typed, weighted, polarity-aware terms.
create table profile_terms (
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

-- External source registry — lets Section 7.5's "one broken connector never stalls
-- the pipeline" rule be enforced and observed per source, not just globally.
create table sources (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('api','agency_page')),
  name text not null unique,                -- 'OpenAlex' | 'Crossref' | 'Semantic Scholar' | 'Grants.gov' | agency name
  base_url text not null,
  enabled boolean not null default true,
  health_status text not null default 'unknown' check (health_status in ('healthy','degraded','down','unknown')),
  created_at timestamptz not null default now()
);

-- Canonical opportunity. Deliberately holds NO deadline column — see opportunity_deadlines below.
create table opportunities (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('journal','venue','funding')),
  title text not null,
  summary text,
  agency_or_publisher text,
  venue_name text,
  doi text,
  status text not null default 'unknown' check (status in ('open','forecasted','upcoming','closed','unknown')),
  fingerprint text not null unique,         -- multi-stage dedup key, see 6.3 — replaces v1.0's single dedup_hash
  discovered_at timestamptz not null default now(),
  embedding vector(384),                    -- backs topic_similarity
  metadata jsonb                            -- original API response, for auditability (was raw_payload)
);

-- Cross-source provenance. A single opportunity can be reported by more than one
-- source (e.g. both OpenAlex and Crossref surface the same journal special issue) —
-- this table is what lets the UI show "first discovered" and "also seen via" honestly.
create table opportunity_sources (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  source_id uuid not null references sources(id) on delete restrict,
  external_id text,                         -- the source's own ID for this item, when it has one
  source_url text not null,                 -- REQUIRED citation (governance rule — never null)
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (opportunity_id, source_id)
);

-- Decoupled multi-deadline model. One venue/grant can have several distinct dates
-- (LOI, full proposal, special-issue cutoff, event date) — storing them as separate
-- rows prevents the v1.0 bug class of overwriting one date with another.
create table opportunity_deadlines (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  deadline_type text not null check (deadline_type in ('submission','letter_of_intent','full_proposal','special_issue','event_start','other')),
  deadline_date date not null,
  timezone text not null default 'Asia/Kolkata',
  confidence text not null default 'unknown' check (confidence in ('confirmed','probable','unknown','closed','changed')),
  raw_text text,                            -- the original source text the date was parsed from, for audit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Append-only audit trail of every relevance computation (deliverable #2).
-- Now stores the full component breakdown and band, not just one float.
create table scoring_log (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  faculty_id uuid not null references faculty_profile(id) on delete cascade,
  final_score numeric(5,2) not null check (final_score between 0 and 100),
  band text not null check (band in ('high','strong','watch','low','not_eligible')),
  components jsonb not null,                -- {topic_similarity, exact_term_match, method_match, application_match, venue_or_funder_fit, recency, deadline_actionability}
  matched_terms text[] not null default '{}',
  negative_matches text[] not null default '{}',
  model_version text not null default 'component-v1',
  scored_at timestamptz not null default now()
);

-- Dedup memory: what has already been alerted, on which channel.
create table alerts_sent (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  faculty_id uuid not null references faculty_profile(id) on delete cascade,
  channel text not null check (channel in ('dashboard','email','telegram')),
  alert_type text not null check (alert_type in ('new_high_relevance','deadline_critical','deadline_urgent','deadline_changed','weekly_digest')),
  dedupe_key text not null unique,          -- faculty_id|opportunity_id|alert_type|deadline_date|band
  sent_at timestamptz not null default now()
);

-- Faculty's own tracking state. This is the ONLY way "pursuing" ever gets set —
-- always a direct, logged, human action. Nothing here is set automatically.
create table opportunity_status (
  opportunity_id uuid primary key references opportunities(id) on delete cascade,
  faculty_id uuid not null references faculty_profile(id) on delete cascade,
  status text not null default 'new' check (status in ('new','pursuing','dismissed')),
  updated_at timestamptz not null default now(),
  updated_by text not null default 'faculty'
);

-- Closed-loop faculty feedback. Captures explicit ratings and negative domain terms
-- from dismissed opportunities to penalize similar irrelevant candidates dynamically.
create table feedback (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  faculty_id uuid not null references faculty_profile(id) on delete cascade,
  rating text not null check (rating in ('relevant','not_relevant','neutral')),
  feedback_text text not null default '',
  negative_terms text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- One row per pipeline execution. Used for observability, the activity/governance
-- page, and CI verification (definition-of-done check #1).
create table run_log (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','partial_failure','failed')),
  opportunities_found int not null default 0,
  opportunities_new int not null default 0,
  errors jsonb not null default '[]'
);

-- Per-source ingestion audit, one row per source per pipeline run. This is what
-- "strict source isolation" actually means in practice: a source's health, failure
-- category, and latency are tracked independently, so one broken connector shows
-- up as one bad row here — never as a reason the other sources' data is missing.
create table source_runs (
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

create index on opportunities (fingerprint);
create index on opportunities (kind);
create index on opportunity_deadlines (deadline_date);
create index on opportunity_deadlines (opportunity_id);
create index on opportunity_sources (opportunity_id);
create index on scoring_log (opportunity_id);
create index on source_runs (run_id);
```

**Heads-up for later in 2026:** Supabase is rolling out a rule that new/free projects must have **explicit `grant` statements** for a table to be reachable through the auto-generated REST API (PostgREST), effective for existing free projects from 30 October 2026. Because this build only ever touches Supabase through the **service-role key** (server-side, bypasses PostgREST's anon/authenticated grants), this does not block you. Only add grants if you later decide to let the browser query Supabase directly with the anon key — in that case add, per exposed table: `grant select on <table> to anon;` and re-check Supabase's current docs, since usage-based rules on hosted platforms get refined after rollout.

### 6.2 Relevance-scoring algorithm — transparent, component-based

v1.0 returned one cosine-similarity float with no explanation. That's replaced with a deterministic, weighted, **explainable** 0–100 score, computed entirely locally (no per-item LLM call, matching the free-tier goal in Section 2).

**Component weights:**

| Component | Weight | Calculation | Free/local method used |
|---|---|---|---|
| Topic similarity | 35% | Semantic closeness between opportunity text and the faculty's `profile_text` | `all-MiniLM-L6-v2` cosine similarity (same model as v1.0 — kept because it's a stronger free signal than TF-IDF, just no longer the *only* signal) |
| Exact/high-value term match | 20% | Weighted overlap between opportunity text and `profile_terms` where `term_type='topic'`, after normalization | Substring/token match against `profile_terms.weight` |
| Method match | 10% | Overlap between opportunity text and `profile_terms` where `term_type='method'` | Same term-match logic, scoped by type |
| Application/domain match | 10% | Overlap between opportunity text and `profile_terms` where `term_type='application'` | Same term-match logic, scoped by type |
| Venue/funder fit | 10% | Opportunity's `agency_or_publisher`/`venue_name` against `profile_terms` where `term_type in ('venue','funding_theme')` | Exact/fuzzy string match |
| Recency/newness | 5% | Newly-discovered items get a modest boost; decays over the alert window | `max(0, 1 - days_since_first_seen / 14) * 100` |
| Deadline actionability | 10% | A closer **confirmed** deadline raises priority; `unknown`/`probable` deadlines never fabricate urgency | See 6.4's proximity policy — 0 unless `confidence='confirmed'` |

```python
# radar/scoring/component_scorer.py
def score_opportunity(opportunity: Opportunity, profile: FacultyProfile, profile_terms: list[ProfileTerm]) -> ScoreResult:
    """
    Deterministic, explainable 0-100 scorer. Same inputs always produce the same
    output (model_version pinned), which is what makes scoring_log auditable.
    Never lets citation count, journal prestige, or an LLM call influence the score.
    """
    topic_similarity = cosine_to_pct(embed_cosine(opportunity.embedding, profile.profile_embedding))
    exact_term_match, matched = weighted_term_match(opportunity, profile_terms, term_type="topic")
    method_match, _ = weighted_term_match(opportunity, profile_terms, term_type="method")
    application_match, _ = weighted_term_match(opportunity, profile_terms, term_type="application")
    venue_fit = venue_or_funder_fit(opportunity, profile_terms)
    recency = recency_score(opportunity.discovered_at)
    deadline_actionability, negative = deadline_actionability_score(opportunity)  # 0 unless confirmed — see 6.4

    negative_penalty = negative_term_penalty(opportunity, profile_terms)  # up to 25 points, term_type='topic', polarity='negative'
    feedback_penalty, fb_matches = compute_feedback_penalty(opportunity, negative_signals) # up to 35 points from dismissed feedback

    base = (
        0.35 * topic_similarity + 0.20 * exact_term_match + 0.10 * method_match +
        0.10 * application_match + 0.10 * venue_fit + 0.05 * recency + 0.10 * deadline_actionability
    )
    final_score = clamp(base - (negative_penalty + feedback_penalty), 0, 100)
    band = "not_eligible" if hard_ineligible(opportunity) else score_band(final_score)

    return ScoreResult(final_score=final_score, band=band, components={...}, matched_terms=matched, negative_matches=negative + fb_matches)
```

**Score bands** (replaces v1.0's single `RELEVANCE_THRESHOLD` cutoff):

| Band | Range | Alert behavior |
|---|---|---|
| `high` | 80–100 | Always eligible for the "new high-relevance" alert |
| `strong` | 65–79 | Shown on dashboard by default; eligible for deadline alerts |
| `watch` | 50–64 | Shown on dashboard; not proactively alerted unless a confirmed deadline is close |
| `low` | <50 | Hidden by default, visible via an explicit filter |
| `not_eligible` | forced to 0 | Hard ineligibility rule fired at high confidence (e.g., wrong discipline domain) — shown in `/activity` only, never alerted |

**Rules that keep this from becoming a black box again:**
- Negative research terms (`profile_terms.polarity='negative'`) subtract up to 25 points but can never push the score below 0.
- Closed-loop feedback penalty (`feedback.negative_terms`) subtracts up to 35 points based on items previously marked `dismissed` by the faculty member.
- `deadline_actionability` is **0**, not a guess, whenever the best available `opportunity_deadlines` row has `confidence` of `unknown` or `probable` — an unconfirmed date must never manufacture false urgency.
- Every score persists a full `components` JSON and `matched_terms` list to `scoring_log`, so the dashboard can show *exactly* why an item surfaced instead of a bare number.

**Score explanation object** (this is what `GET /api/opportunities/:id` returns and what the dashboard renders per item):

```json
{
  "model_version": "component-v1",
  "final_score": 82.4,
  "band": "high",
  "components": {
    "topic_similarity": 91,
    "exact_term_match": 84,
    "method_match": 70,
    "application_match": 90,
    "venue_or_funder_fit": 80,
    "recency": 100,
    "deadline_actionability": 65
  },
  "matched_terms": ["edge AI", "sensor fusion"],
  "negative_matches": [],
  "eligibility": { "status": "unknown", "confidence": 0.4 }
}
```

### 6.3 Deduplication — multi-stage hierarchy

v1.0 deduplicated on a single hash of `title|source|deadline`, which silently created duplicates whenever a source reworded a title or reported a different deadline for the same call. The `opportunities.fingerprint` unique constraint is now populated by trying, in order, the first match that succeeds:

1. **Exact DOI match** (journals/venues with a DOI).
2. **Exact official agency call/grant number** (`external_id` + `agency_or_publisher` from `opportunity_sources`).
3. **Exact normalized official URL.**
4. **Exact normalized title + same source/funder.**
5. **Bounded fuzzy title match** (`rapidfuzz.fuzz.token_sort_ratio >= 92`) plus at least one overlapping signal (organization, venue, or deadline month) — anything below this bound is treated as a **new** opportunity, never silently merged. A false merge is worse than a duplicate in a research-alert product.

```python
# radar/dedup/fingerprint.py
import hashlib, re
from rapidfuzz import fuzz

def normalize(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())

def compute_fingerprint(kind: str, title: str, agency_or_publisher: str | None, doi_or_external_id_or_url: str | None) -> str:
    key = f"{kind}|{normalize(title)}|{normalize(agency_or_publisher)}|{normalize(doi_or_external_id_or_url)}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()

def find_existing_match(candidate: Opportunity, existing: list[Opportunity]) -> Opportunity | None:
    """Runs the 5-stage matching order above and returns the first hit, or None
    (meaning: insert as new). Stage 5 requires BOTH the fuzzy-score bound AND an
    overlapping signal — never fuzzy-title alone."""
```

If a fresh scan re-reports an opportunity that already exists, the pipeline does **not** insert a new row — it updates `opportunity_sources.last_seen_at` for that source (or inserts a new `opportunity_sources` row if this is a source that hadn't reported it before) and re-evaluates its `opportunity_deadlines`, per 6.4's `changed` state.

### 6.4 Deadline engine — stateful, never fabricated

Each `opportunity_deadlines` row carries a `confidence` state, and alerting behavior depends on it:

| State | Meaning | Alert behavior |
|---|---|---|
| `confirmed` | Structured date from a trusted field, or explicit page text a parser validated | Eligible for deadline alerts and `deadline_actionability` scoring |
| `probable` | A parser found a date but the surrounding context needs review | Shown in the UI with a warning icon; never creates a high-confidence alert |
| `unknown` | No reliable date could be parsed | No deadline alarm fires; the opportunity itself stays fully discoverable (a missing deadline is never a reason to drop the item) |
| `closed` | The deadline has passed | Removed from the active alert queue; still visible in history |
| `changed` | A previously `confirmed` date changed on re-scan | Triggers a `deadline_changed` alert and re-evaluates all pending alerts for this opportunity |

**Proximity policy** (used for both `deadline_actionability` scoring and alert urgency):

```python
def deadline_urgency(deadline_date: date, faculty_timezone: str) -> str:
    days_left = (local_date(deadline_date, faculty_timezone) - local_date(now(), faculty_timezone)).days
    if days_left < 0:      return "closed"
    elif days_left <= 3:   return "critical"
    elif days_left <= 7:   return "urgent"
    elif days_left <= 14:  return "soon"
    elif days_left <= 30:  return "upcoming"
    else:                  return "distant"
```

Thresholds are stored in config, and the threshold actually used is recorded on `alerts_sent` (via `dedupe_key`) so historical alerts stay explainable even if the thresholds are tuned later. A parsing failure on a source's raw deadline text is stored as `confidence='unknown'` — **never** as a fabricated date and never as a reason to drop the opportunity from the feed entirely (this directly extends the governance rule in Section 10).

---

## 7. Backend / pipeline design

### 7.1 Repository layout (monorepo — one repo, two runtimes)

```
research-opportunity-radar/
├── SPEC.md                          # this document
├── radar/                           # Python pipeline + MCP server
│   ├── __init__.py
│   ├── config.py                    # reads all env vars, one place only
│   ├── models.py                    # Opportunity, FacultyProfile, RunSummary dataclasses
│   ├── sources/
│   │   ├── __init__.py
│   │   ├── rate_limiter.py          # Thread-safe rate pacing (5/s, 3/s, 2/s)
│   │   ├── openalex_client.py
│   │   ├── crossref_client.py
│   │   ├── semantic_scholar_client.py
│   │   ├── grants_gov_client.py
│   │   ├── agency_scraper_base.py   # abstract base for pluggable agency adapters
│   │   └── agencies/
│   │       ├── example_indian_agency.py # DST-SERB adapter
│   │       ├── icmr_adapter.py          # ICMR adapter
│   │       └── dbt_adapter.py           # DBT India adapter
│   ├── agents/
│   │   ├── discovery_agent.py       # Live NSF RSS & WikiCFP discovery agent
│   │   └── eligibility_agent.py     # 4-point compliance dossier & tenure clock gatekeeper
│   ├── tools/
│   │   ├── journal_watch.py         # journal_watch(field) -> list[Opportunity]
│   │   ├── funding_deadline_scan.py # funding_deadline_scan(agency_list) -> list[Opportunity]
│   │   └── relevance_score.py       # thin wrapper around scoring/component_scorer.py
│   ├── scoring/
│   │   └── component_scorer.py      # score_opportunity(...) -> ScoreResult (6 components + feedback penalty)
│   ├── dedup/
│   │   └── fingerprint.py           # compute_fingerprint(), find_existing_match() — Section 6.3
│   ├── deadlines/
│   │   └── deadline_engine.py       # deadline_urgency(), confidence classification — Section 6.4
│   ├── memory/
│   │   ├── faculty_profile_store.py
│   │   └── seen_opportunities_store.py
│   ├── governance/
│   │   └── rules.py                 # validate_before_alert(opportunity) -> bool, reasons
│   ├── notify/
│   │   ├── telegram.py
│   │   ├── email_brevo.py
│   │   ├── digest_builder.py
│   │   └── deadline_alert.py        # Urgent 72-hour deadline sentinel
│   ├── calendar/
│   │   └── ics_builder.py
│   ├── logging_config.py            # Structured contextual logger
│   ├── orchestrator/
│   │   └── pipeline.py              # Watch -> Score -> Validate -> Alert standing loop
│   └── db/
│       ├── client.py
│       └── schema.sql               # exact copy of Section 6 + feedback table
├── mcp_server.py                    # exposes the same tools over MCP
├── scripts/
│   └── check_env.py                 # fail-loudly CLI diagnostic and live HTTP probe
├── prompts/
│   └── weekly_scan.md               # the reusable prompt command deliverable
├── requirements.txt
├── samples/
│   ├── sample_faculty_profile.json
│   └── sample_digest.md
├── tests/
│   ├── unit/
│   │   ├── test_component_scorer.py
│   │   ├── test_config_validation.py
│   │   ├── test_deadline_alerts.py
│   │   ├── test_deadline_engine.py
│   │   ├── test_discovery_agent.py
│   │   ├── test_eligibility_agent.py
│   │   ├── test_feedback_loop.py
│   │   ├── test_fingerprint.py
│   │   ├── test_governance_rules.py
│   │   ├── test_ics_builder.py
│   │   └── test_indian_agency_adapters.py
│   └── integration/
│       ├── test_grants_gov_client.py     # HTTP mocked
│       ├── test_openalex_client.py       # HTTP mocked with responses
│       ├── test_pipeline_end_to_end.py   # fully mocked network, real DB test schema
│       └── test_pipeline_idempotency.py  # 2-run idempotency verification test
├── web/                              # Next.js app (frontend + API routes)
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                  # Dashboard (radar feed)
│   │   ├── opportunities/[id]/page.tsx
│   │   ├── deadlines/page.tsx
│   │   ├── profile/page.tsx
│   │   ├── digests/page.tsx
│   │   ├── activity/page.tsx         # governance/activity log page
│   │   └── api/
│   │       ├── opportunities/route.ts
│   │       ├── opportunities/[id]/status/route.ts
│   │       ├── deadlines/route.ts
│   │       ├── digest/latest/route.ts
│   │       ├── profile/route.ts
│   │       └── pipeline/trigger/route.ts
│   ├── components/
│   ├── lib/
│   │   └── supabaseServerClient.ts
│   ├── styles/
│   │   └── tokens.css                # design tokens from Section 9
│   ├── tests/
│   │   ├── unit/
│   │   └── e2e/
│   ├── package.json
│   └── tailwind.config.ts
└── .github/
    └── workflows/
        ├── pipeline.yml               # scheduled Python pipeline
        └── frontend-ci.yml            # lint/typecheck/test on every push
```

### 7.2 Configuration and secrets

Create `.env.example` at repo root (never commit a real `.env`):

```
# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# OpenAlex
OPENALEX_API_KEY=

# Crossref (polite pool, optional but recommended)
CROSSREF_MAILTO=

# Semantic Scholar (optional)
SEMANTIC_SCHOLAR_API_KEY=

# Telegram (optional notification channel)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Brevo (optional notification channel)
BREVO_API_KEY=
BREVO_SENDER_EMAIL=
BREVO_RECIPIENT_EMAIL=

# Tunables
MIN_RELEVANCE_BAND=watch        # high | strong | watch | low — dashboard visibility floor (Section 6.2)
DEADLINE_ALERT_WINDOW_DAYS=30   # matches faculty_profile.deadline_alert_window_days default
```

Add the same names as **GitHub repository secrets** (Settings → Secrets and variables → Actions) for the pipeline, and as **Vercel project environment variables** for the frontend (only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are needed on Vercel, since the frontend never calls the scholarly APIs directly).

### 7.3 Core modules — signatures and behaviour

```python
# radar/tools/journal_watch.py
def journal_watch(field: str) -> list[Opportunity]:
    """
    Queries OpenAlex and Crossref for journals/venues active in `field`.
    Returns a de-duplicated list of Opportunity(kind='journal'|'venue', ...).
    Each item MUST have source_name and source_url populated before return.
    Never raises on a single source failing — logs and continues with the other source.
    """

# radar/tools/funding_deadline_scan.py
def funding_deadline_scan(agency_list: list[str]) -> list[Opportunity]:
    """
    For each agency name in agency_list, dispatches to the matching adapter
    (Grants.gov client, or a registered agency scraper). Returns
    Opportunity(kind='funding', ...) items, each carrying zero or more
    parsed OpportunityDeadline(deadline_type, deadline_date, confidence, ...)
    objects rather than a single date field (Section 6.4) — a grant with an
    LOI date and a full-proposal date produces two deadline rows, not one.
    An unknown agency name is logged as a warning and skipped, not a crash.
    """

# radar/tools/relevance_score.py
def relevance_score(opportunity: Opportunity, faculty_profile: FacultyProfile) -> ScoreResult:
    """
    Thin wrapper that loads profile_terms for the given faculty_profile and
    delegates to radar.scoring.component_scorer.score_opportunity() (Section 6.2).
    Kept as a separate, stable function name/signature because it's also the
    MCP tool `score_relevance` (Section 11.1) — callers there only need the
    top-level float (`ScoreResult.final_score`), everything else in the object
    is for the dashboard and scoring_log.
    Deterministic for a given model_version - same inputs always give the same
    result, which is what makes scoring_log auditable.
    """
```

Fingerprint computation and multi-stage matching (used for the `opportunities.fingerprint` unique constraint) is exactly as specified in **Section 6.3** — `radar/dedup/fingerprint.py::compute_fingerprint()` and `find_existing_match()`. Do not reintroduce a single-field hash; every insert path must call `find_existing_match()` before `compute_fingerprint()` decides whether a row is new.

Agency adapter interface (so adding a new funding source is copy-paste, not a rewrite):

```python
# radar/sources/agency_scraper_base.py
from abc import ABC, abstractmethod

class AgencyAdapter(ABC):
    agency_name: str

    @abstractmethod
    def fetch_open_calls(self) -> list[dict]:
        """Return raw dicts with at minimum: title, url, deadline (str|None)."""
```

`radar/sources/agencies/example_indian_agency.py` implements this interface against one real, public, non-login-walled "current calls" page using `requests` + `BeautifulSoup`, and includes a `robots.txt` check before the first fetch, plus a content-hash cache so re-runs don't re-parse unchanged pages.

### 7.4 Orchestration: Watch → Score → Validate → Alert

```python
# radar/orchestrator/pipeline.py
def run_pipeline(dry_run: bool = False) -> RunSummary:
    run_id = db.start_run_log()
    try:
        profile = faculty_profile_store.get_active_profile()
        profile_terms = faculty_profile_store.get_profile_terms(profile.id)

        # WATCH — each source call is wrapped individually so one broken
        # connector never stalls the others (Section 7.5), and every source
        # gets its own source_runs row for isolated observability (Section 6.1).
        found = []
        for source_name, fetch in registered_sources():
            source_run_id = db.start_source_run(run_id, source_name)
            try:
                items = fetch(profile.research_keywords, config.AGENCY_LIST)
                found += items
                db.finish_source_run(source_run_id, status="success", request_count=..., inserted_count=len(items))
            except Exception as e:
                db.finish_source_run(source_run_id, status="failed", error_category=classify(e))
                continue  # the run continues with whatever other sources returned

        # DEDUPLICATE — multi-stage match against existing rows (Section 6.3)
        # BEFORE scoring, so scoring_log is only ever written once per real item.
        existing = db.load_recent_opportunities()
        to_score, provenance_updates = [], []
        for candidate in found:
            candidate.fingerprint = fingerprint.compute_fingerprint(
                candidate.kind, candidate.title, candidate.agency_or_publisher,
                candidate.doi or candidate.external_id or candidate.source_url)
            match = fingerprint.find_existing_match(candidate, existing)
            if match:
                provenance_updates.append((match.id, candidate.source_name, candidate.source_url))  # opportunity_sources upsert
            else:
                to_score.append(candidate)

        # SCORE — component-based, explainable (Section 6.2); every scored item,
        # accepted or not, is written to scoring_log for full auditability.
        for opp in to_score:
            opp.embedding = embed(opp.title + " " + (opp.description or ""))
            opp.score_result = component_scorer.score_opportunity(opp, profile, profile_terms)

        # Deadlines are parsed per source item into opportunity_deadlines rows,
        # each carrying its own confidence state (Section 6.4) — never a single
        # guessed date on the opportunity record itself.

        # VALIDATE (governance gate — see governance/rules.py)
        accepted, rejected = [], []
        for opp in to_score:
            ok, reason = governance.validate_before_alert(opp)
            (accepted if ok else rejected).append((opp, reason))

        # write everything scored to opportunities + opportunity_deadlines +
        # opportunity_sources + scoring_log regardless of acceptance, for full
        # auditability; the fingerprint unique constraint silently no-ops on
        # repeats (ON CONFLICT DO NOTHING) as a database-level safety net even
        # though find_existing_match() already caught them above
        new_count = db.upsert_opportunities(accepted, provenance_updates)

        # ALERT — only for NEW opportunities meeting their band's alert policy
        # (Section 24-equivalent: 'high' always alerts; 'strong'/'watch' alert
        # only on a confirmed, close deadline), and only ever informational
        # (no downstream action is ever triggered)
        to_alert = [o for o in accepted if o.is_new and alert_policy.should_alert(o.score_result)]
        if to_alert and not dry_run:
            digest = digest_builder.build(to_alert)
            notify.telegram.send(digest)   # and/or notify.email_brevo.send(digest)
            calendar.ics_builder.regenerate_and_upload()  # reads opportunity_deadlines, confidence='confirmed' only

        db.finish_run_log(run_id, status="success", found=len(found), new=new_count, errors=rejected)
        return RunSummary(...)
    except Exception as e:
        db.finish_run_log(run_id, status="failed", errors=[str(e)])
        raise
```

**Scheduling — make the repository public.** GitHub Actions `schedule:` triggers are unreliable/disabled on **private** repositories under the free personal plan; they run reliably and with **unlimited free minutes** on **public** repositories. Since no secret ever lives in code (only in GitHub Secrets, referenced as `${{ secrets.X }}`), and the only data this repo contains is code plus synthetic sample data (`/samples`), making it public is safe. Never commit a real faculty profile, real email addresses, or real bot tokens into the repo itself.

```yaml
# .github/workflows/pipeline.yml
name: opportunity-radar-pipeline
on:
  schedule:
    - cron: '17 3 * * 1,4'   # Mon & Thu, 03:17 UTC — off-peak minute avoids scheduler congestion
  workflow_dispatch: {}       # lets you trigger it manually from the Actions tab any time
permissions:
  contents: read
jobs:
  run-pipeline:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - name: Cache sentence-transformers model
        uses: actions/cache@v4
        with:
          path: ~/.cache/torch/sentence_transformers
          key: minilm-l6-v2
      - run: pip install -r requirements.txt
      - name: Run pipeline
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          OPENALEX_API_KEY: ${{ secrets.OPENALEX_API_KEY }}
          CROSSREF_MAILTO: ${{ secrets.CROSSREF_MAILTO }}
          SEMANTIC_SCHOLAR_API_KEY: ${{ secrets.SEMANTIC_SCHOLAR_API_KEY }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
          MIN_RELEVANCE_BAND: 'watch'
        run: python -m radar.orchestrator.pipeline
```

Running **twice a week** (not once) also keeps the Supabase free project from auto-pausing, which happens after **7 days of inactivity**.

### 7.5 Error handling and rate-limit policy

- Every source client wraps its HTTP calls with `tenacity` retry: 3 attempts, exponential backoff starting at 2 seconds, retrying only on `429` and `5xx`.
- Each of the three watch sources (OpenAlex, Crossref, Semantic Scholar) is called inside its own `try/except`; one source failing is logged to `run_log.errors` **and** given its own `source_runs` row with `status='failed'` and an `error_category` (Section 6.1) — it does **not** stop the other sources or the run. This per-source row is what makes "strict source isolation" verifiable rather than a claim: the `/activity` page can show exactly which source degraded on which run, independent of the others.
- Semantic Scholar calls (if used without a key) are throttled client-side to at most 1 request/second using a simple token-bucket sleep, regardless of what the shared pool currently allows, to be a good citizen.
- Any opportunity missing `source_url` is dropped before it ever reaches the database — this is a hard governance gate, not a warning (Section 10).
- Deadline parsing never raises past the item level: a malformed date on one source item is caught, that `opportunity_deadlines` row is written with `confidence='unknown'` and `raw_text` set to the original string, and the rest of the run continues unaffected (Section 6.4).

---

## 8. Frontend/backend API contract

All endpoints below are Next.js API routes (`web/app/api/.../route.ts`), running server-side on Vercel, and are the **only** way the browser reaches Supabase.

| Method | Path | Purpose | Response shape (key fields) |
|---|---|---|---|
| GET | `/api/opportunities` | List opportunities, newest first, with score band + status joined | `{ id, kind, title, primary_source_name, primary_source_url, next_deadline: { deadline_date, confidence } \| null, final_score, band, matched_terms, status }[]` |
| GET | `/api/opportunities/:id` | Full detail: all `opportunity_deadlines` rows, all `opportunity_sources` rows (provenance/citations), the full score explanation object (Section 6.2), and `scoring_log` history | single object |
| POST | `/api/opportunities/:id/status` | Faculty sets `pursuing` or `dismissed` — the only write a human can trigger | `{ status: 'pursuing' \| 'dismissed' }` → 200 |
| GET | `/api/deadlines` | Upcoming deadlines across all opportunities, sorted by date, with confidence shown per item | `{ opportunity_id, title, deadline_type, deadline_date, confidence, source_url }[]` |
| GET | `/api/digest/latest` | Most recent weekly digest markdown | `{ generated_at, markdown }` |
| GET | `/api/profile` / POST `/api/profile` | Read/update faculty keywords, profile text, and `profile_terms` | `{ full_name, research_keywords, profile_text, profile_terms: { term, term_type, weight, polarity }[] }` |
| GET | `/api/activity` | Recent `run_log` rows joined with their `source_runs` — per-source health, not just pipeline-level | `{ run_id, started_at, status, sources: { source_name, status, error_category, latency_ms }[] }[]` |
| POST | `/api/pipeline/trigger` | Calls GitHub's `workflow_dispatch` REST API via a stored PAT, so the dashboard has a "Run now" button (optional, Phase 11) | 202 Accepted |

Validation: every request body is parsed with `zod` on the server; malformed input returns `400` with a field-level error list, never a silent failure.

---

## 9. Frontend design system

Following a deliberate design process rather than default styling — this section is what keeps the UI from reading as AI-generated.

### 9.1 Grounding
The subject is a scholarly instrument: something that scans, tracks, and surfaces signals against deadlines — closer to an **observatory instrument panel** than a SaaS dashboard. The audience is one faculty member checking it a few times a week, not a marketing site. That points away from bright gradients and card-grids and toward something calmer, denser with real information, and print/scholarly in its type choices.

### 9.2 Design plan

**Color** (6 named values):
| Name | Hex | Use |
|---|---|---|
| Ink | `#10151B` | Page background |
| Panel | `#171E27` | Card/panel surfaces |
| Parchment | `#EDE6D6` | Primary text on dark surfaces |
| Brass | `#C08A3E` | Primary accent — links, active states, the scan indicator |
| Verdigris | `#5B8C7B` | Positive/safe deadline state, "pursuing" status |
| Rust | `#B5482F` | Urgent deadline (≤7 days), "dismissed" state |

**Type:**
- Display/headline: **Fraunces** (variable serif, has real optical-size personality — not Playfair, not a default choice) for page titles and opportunity titles on the detail page.
- Body/UI: **Public Sans** (humanist, legible at small sizes, not Inter) for all body text, labels, and navigation.
- Numerals only (deadline countdowns, relevance-score digits): **Spline Sans Mono**, tabular figures, used *only* where digits need to visually line up like a scoreboard — not used for labels or headings.

**Layout:** Left-to-right asymmetric grid, left-aligned text throughout (no centered marketing-style blocks). Left rail (fixed, narrow): faculty name, keyword chips (editable), quick filters. Main column: the radar feed as a dense list (not a card grid) — each row is title, source, one-line relevance reason, score digits, deadline countdown. Right rail (on wide screens only, collapses under main column on mobile): an actual chronological deadline timeline, since that content genuinely is a sequence — numbering here is earned, not decorative.

```
┌───────────┬────────────────────────────────────────┬───────────────┐
│ Faculty:  │  Research Opportunity Radar             │  Deadlines    │
│ Dr. Vibha │  last scanned: 2 days ago  [sweep dot]  │               │
│           │                                          │  ● Sep 12 —   │
│ keywords: │  ─────────────────────────────────────  │    SERB Core  │
│ [GNN] [+] │  IEEE TKDE — special issue on graph...   │  ● Oct 03 —   │
│ [fraud    │  Crossref · fit: shares 3 of your 5      │    DST-ICPS   │
│ detection]│  keywords         score 0.81   deadline: │               │
│           │  rolling                                 │  (full list → │
│ [filters] │  ─────────────────────────────────────  │   /deadlines) │
│           │  SERB Core Research Grant                │               │
│           │  Grants-adapter · fit: direct keyword    │               │
│           │  match "financial fraud graph models"    │               │
│           │  score 0.77   deadline: 8 days            │               │
└───────────┴────────────────────────────────────────┴───────────────┘
```

**Principles:**
- One motion moment only: a small pulsing dot next to "last scanned" that briefly sweeps like a radar return on page load, then goes still. Nothing else animates on scroll or hover beyond a simple color shift on focus/hover for accessibility.
- No ALL-CAPS eyebrows, no em-dash chrome, no numbered 01/02/03 badges outside the deadline timeline (which is a real sequence).
- Every opportunity row shows its citation (primary source, linked to its `source_url`) inline, undecorated — this is a governance requirement made visible, not just a policy. If an opportunity has more than one `opportunity_sources` row, a small "+2 other sources" note is shown, expandable to the full provenance list with each source's `first_seen_at`.
- The score digit is never shown alone: it always carries its band as a one-word label (`High` / `Strong` / `Watch` / `Low`, colored using Verdigris for High/Strong and left neutral otherwise — Rust is reserved for deadline urgency, not score band, so the two signals never visually collide). Clicking the score opens the component breakdown (Section 6.2's explanation object) as a small inline bar chart, not a modal.
- A deadline is never shown as a bare date. It always carries its confidence: a `confirmed` date renders normally; a `probable` date renders with a dotted underline and a tooltip ("parsed, not yet verified"); `unknown` renders as the word "rolling," never a guessed date.
- Empty states are written in the interface's voice: e.g., if no opportunities are above the visibility floor yet, the feed says *"No matches at Watch or above yet — the next scan runs Thursday. Lower the floor in Profile to see more."* — not a generic "No data found."

### 9.3 Page map
- `/` — Dashboard (the radar feed above)
- `/opportunities/[id]` — Full detail: description, every `opportunity_deadlines` row with its own confidence badge, every `opportunity_sources` row (provenance/citations, "first discovered" + "also seen via"), the full score component breakdown, complete scoring history from `scoring_log`, and the pursue/dismiss action
- `/deadlines` — Full chronological list, each item's confidence visible, + "Subscribe to calendar" link (points at the Supabase Storage `.ics` URL, `webcal://...`) — the feed only ever includes `confirmed` deadlines, by design
- `/profile` — Edit faculty keywords, profile text, and the weighted `profile_terms` vocabulary (topic/method/application/venue/funding-theme, positive or negative) that drives the component scorer (triggers profile-embedding recomputation)
- `/digests` — Archive of past weekly digests (deliverable #1)
- `/activity` — The governance/transparency page: every pipeline run, broken down **per source** via `source_runs` (which source succeeded, degraded, or failed, and why), plus what was rejected and why — makes "informational only" and "one broken connector never stalls the pipeline" both auditable to the faculty member, not just asserted

### 9.4 Data fetching
Server Components fetch on initial page load directly via the Next.js API routes (server-to-server, same deployment). Client-side refresh (e.g., after clicking "pursue") uses `SWR` for optimistic updates and revalidation. The Supabase client with the service-role key is instantiated **only** inside `web/lib/supabaseServerClient.ts`, which is never imported into any file under `app/**/page.tsx` client components — only into `route.ts` files and Server Components.

### 9.5 Accessibility
- Parchment (#EDE6D6) on Ink (#10151B) — verify contrast ratio ≥ 7:1 with a contrast checker during Phase 10 (it should pass comfortably; confirm rather than assume).
- Brass (#C08A3E) on Ink must be checked for text use — if it fails AA for small text, reserve Brass for large text/icons/borders only and use Parchment for small link text with a Brass underline.
- All interactive elements have a visible focus ring (do not remove the default outline without replacing it).
- Respect `prefers-reduced-motion`: the radar-sweep dot animation is disabled entirely for users with that OS setting.

---

## 10. Governance — implementation checklist

Every line item below is a **code-level check**, not a policy statement:

| Brief requirement | Concrete enforcement |
|---|---|
| Alerts are informational only | The pipeline has no function anywhere that calls an "apply/submit/draft" endpoint on any external system. Grep the codebase for `POST` calls at the end of every phase — the only external `POST`s allowed are to Telegram/Brevo (notifications) and Supabase (storage). |
| No proposal auto-started without opting in | `opportunity_status.status` only ever changes via `POST /api/opportunities/:id/status`, which requires an authenticated dashboard click; nothing in `radar/orchestrator/pipeline.py` writes to `opportunity_status`. |
| Every alert cites its source | `opportunity_sources.source_url` is `not null` at the schema level; `governance/rules.py::validate_before_alert()` drops any candidate opportunity missing a URL **before** it is written to the DB, logging the drop to `run_log.errors` rather than silently discarding it. |
| Deadlines are never fabricated | `deadline_actionability` (Section 6.2) is forced to 0 unless the best `opportunity_deadlines.confidence` is `confirmed`; a parse failure is stored as `confidence='unknown'`, never as a guessed date (Section 6.4). |
| Duplicates are never silently merged on weak evidence | `dedup/fingerprint.py::find_existing_match()` only merges on stages 1–4 (exact identifiers) or stage 5 with **both** a fuzzy-score bound and an overlapping signal (Section 6.3) — a title-only fuzzy match is treated as a new opportunity, not merged. |

```python
# radar/governance/rules.py
def validate_before_alert(opp: Opportunity) -> tuple[bool, str | None]:
    if not opp.primary_source_url:
        return False, f"dropped '{opp.title[:60]}': missing source_url"
    if opp.score_result is None or opp.score_result.final_score != opp.score_result.final_score:  # NaN check
        return False, f"dropped '{opp.title[:60]}': invalid score"
    if opp.kind == "funding":
        confirmed_deadline = opp.earliest_confirmed_deadline()  # None if no confirmed row exists
        if confirmed_deadline and confirmed_deadline < today():
            return False, f"dropped '{opp.title[:60]}': deadline already passed"
    return True, None
```

---

## 11. The reusable prompt command (deliverable #4)

Save this as `prompts/weekly_scan.md`. It is meant to be pasted into any chat client that has the `mcp_server.py` tools attached (Section 11.1), so the faculty member (or you) can re-run a scan conversationally instead of only via the schedule.

```markdown
You are the Research Opportunity Radar assistant for {{faculty_name}}
({{department}}, {{institution}}). You have three tools available:
watch_journals(field), scan_funding(agency_list), and score_relevance(opportunity_id).

Do the following, in order:
1. Call watch_journals once for each of these fields: {{research_keywords}}.
2. Call scan_funding with this agency list: {{agency_list}}.
3. For every opportunity returned, call score_relevance and discard anything
   scoring below the "Watch" band (50/100).
4. Sort what's left by deadline proximity (soonest confirmed deadline first,
   never an unconfirmed one), then by score (highest first) for items with
   no confirmed deadline.
5. Produce a short markdown digest. For each opportunity include: title,
   one sentence on why it fits (grounded in the actual overlapping keywords —
   do not invent a reason), the deadline (or "rolling"), and the exact
   source URL as a citation.

Rules you must follow:
- Never recommend an opportunity you cannot cite a real source URL for.
- Do not take any action beyond producing this digest. No drafting proposals,
  no sending emails, no marking anything as "pursuing" — this is
  informational only. The faculty member decides what happens next.
```

### 11.1 Exposing the tools over MCP

```python
# mcp_server.py
from mcp.server.fastmcp import FastMCP
from radar.tools.journal_watch import journal_watch
from radar.tools.funding_deadline_scan import funding_deadline_scan
from radar.tools.relevance_score import relevance_score
from radar.memory.faculty_profile_store import get_active_profile
from radar.db.client import get_opportunity

mcp = FastMCP("research-opportunity-radar")

@mcp.tool()
def watch_journals(field: str) -> list[dict]:
    """Find journals/venues currently active in a given research field."""
    return [o.to_dict() for o in journal_watch(field)]

@mcp.tool()
def scan_funding(agency_list: list[str]) -> list[dict]:
    """Scan the given funding agencies for open calls with deadlines."""
    return [o.to_dict() for o in funding_deadline_scan(agency_list)]

@mcp.tool()
def score_relevance(opportunity_id: str) -> dict:
    """Score a previously discovered opportunity against the active faculty
    profile. Returns the full explanation object (final_score, band,
    components, matched_terms) from Section 6.2 — not just a bare number —
    so a conversational client can explain *why* an item scored the way it did."""
    opp = get_opportunity(opportunity_id)
    profile = get_active_profile()
    return relevance_score(opp, profile).to_dict()

if __name__ == "__main__":
    mcp.run()
```

Install with `pip install mcp`, and register it in your VS Code AI extension or Claude Desktop's MCP config (`command: python`, `args: ["mcp_server.py"]`, working directory = repo root, same environment variables as the pipeline).

---

## 12. Step-by-step build phases

Work through these **in order** in VS Code with your AI coding tool. Each phase lists exactly what to build, the prompt to give the AI tool, how to verify it yourself, and when you're allowed to move on.

### Phase 0 — Accounts and environment (no AI coding yet)
- Create a **public** GitHub repo named `research-opportunity-radar`.
- Create accounts and collect keys: OpenAlex (openalex.org/settings/api), Semantic Scholar (optional, semanticscholar.org/product/api), Supabase (choose a region near India, e.g. `ap-south-1`), Telegram bot via `@BotFather` (optional), Brevo (optional).
- Install: VS Code, Python 3.11, Node.js 20+, and your AI coding extension configured against your OpenRouter (or chosen) API key.
- **Definition of done:** you have a `.env` file locally (git-ignored) with every value in Section 7.2 filled in for the services you're using.

### Phase 1 — Repository scaffold
**Prompt:** "Create the exact folder and file structure in Section 7.1 of SPEC.md, as empty files/stubs with module docstrings only — no logic yet. Add a `.gitignore` covering `.env`, `__pycache__/`, `node_modules/`, `.next/`. Add `requirements.txt` with: requests, httpx, sentence-transformers, numpy, rapidfuzz, supabase, python-dotenv, pydantic, ics, mcp, tenacity, beautifulsoup4, pytest, pytest-mock, responses."
**Verify:** `pip install -r requirements.txt` succeeds with no errors.
**Done when:** the tree matches Section 7.1 exactly.

### Phase 2 — Database
**Prompt:** "Create radar/db/schema.sql containing exactly the SQL in Section 6.1 of SPEC.md. Then create radar/db/client.py with a `get_client()` function that returns a `supabase-py` client built from `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in radar/config.py, plus helper functions: `upsert_opportunities(accepted: list[Opportunity], provenance_updates: list[tuple]) -> int` (returns count of newly-inserted rows, using `on_conflict='fingerprint'`, writing matching `opportunity_deadlines` and `opportunity_sources` rows, and applying `provenance_updates` as `opportunity_sources` upserts for items matched to an existing opportunity), `start_run_log() -> str`, `finish_run_log(run_id, status, found, new, errors)`, `start_source_run(run_id, source_name) -> str`, `finish_source_run(source_run_id, status, ...)`, `get_opportunity(id) -> Opportunity`."
**Verify:** run the SQL manually in the Supabase SQL editor first; confirm all 12 tables (Section 6.1) exist in the Table Editor before writing any Python against it, and seed the `sources` table with one row per source (OpenAlex, Crossref, Semantic Scholar, Grants.gov) since `source_runs` and `opportunity_sources` both foreign-key against it.
**Done when:** a manual `insert into faculty_profile (...) values (...)` succeeds, and `get_client()` can read it back from a local Python REPL.

### Phase 3 — Source clients
**Prompt:** "Implement radar/sources/openalex_client.py with `search_works(query: str, per_page: int = 25) -> list[dict]` (GET https://api.openalex.org/works, params search=query, per_page, api_key=OPENALEX_API_KEY from radar/config.py) and `get_work_by_id(openalex_id: str) -> dict`. Wrap both in tenacity retry: 3 attempts, exponential backoff from 2s, retry on 429/5xx only. Then implement radar/sources/crossref_client.py with the same two functions against https://api.crossref.org/works, using `mailto=CROSSREF_MAILTO` instead of an API key. Then radar/sources/semantic_scholar_client.py with `search_papers(query: str) -> list[dict]` against https://api.semanticscholar.org/graph/v1/paper/search, sending header `x-api-key` only if SEMANTIC_SCHOLAR_API_KEY is set, and client-side throttling to 1 request/second if it is not set. Then radar/sources/grants_gov_client.py with `search_opportunities(keyword: str) -> list[dict]` doing a POST to https://api.grants.gov/v1/api/search2 with body `{'keyword': keyword, 'oppStatuses': 'posted|forecasted', 'rows': 50, 'startRecordNum': 0}`, returning `response['data']['oppHits']`. Every function needs a module docstring citing its official docs URL from Section 4."
**Verify:** write a one-off script that calls each function with a real query and prints the first result — run it manually once to confirm real API access works, then delete the script (the real tests come in Phase 12).
**Done when:** all four clients return real data for a test query without raising.

### Phase 4 — Core tools and embeddings
**Prompt:** "Implement radar/dedup/fingerprint.py exactly as specified in Section 6.3 of SPEC.md: `compute_fingerprint()` and `find_existing_match()` implementing the 5-stage matching order (DOI → agency call number → normalized URL → exact title+source → bounded fuzzy match with rapidfuzz, requiring an overlapping signal). Implement radar/scoring/component_scorer.py exactly as specified in Section 6.2: `score_opportunity(opportunity, profile, profile_terms)` loading `sentence-transformers/all-MiniLM-L6-v2` once at module level (not per call) for the topic_similarity component, plus the six other weighted components, the negative-term penalty, and `score_band()` mapping the final 0–100 score to `high`/`strong`/`watch`/`low`/`not_eligible`. Implement radar/deadlines/deadline_engine.py with `deadline_urgency()` and `classify_deadline_confidence()` per Section 6.4. Then implement radar/tools/journal_watch.py: `journal_watch(field)` calls openalex_client.search_works and crossref_client.search_works with `field` as the query, maps each raw result into an `Opportunity(kind='journal', ...)` using models.py, wraps each source call in try/except so one failing source doesn't stop the other, and calls `fingerprint.find_existing_match()` before returning. Implement radar/tools/funding_deadline_scan.py: `funding_deadline_scan(agency_list)` — for 'Grants.gov' in the list, calls grants_gov_client; for any other name, looks it up in a registry of AgencyAdapter subclasses (radar/sources/agencies/) and calls `fetch_open_calls()`; unknown names are logged and skipped, not errors. Implement radar/tools/relevance_score.py as the thin wrapper described in Section 7.3, delegating to component_scorer.score_opportunity()."
**Verify:** `score_opportunity()` on two clearly-related texts should return a `final_score` in the 60–90 range with `topic_similarity` as the dominant component, and on two unrelated texts something under 50 — sanity check manually before trusting it. Confirm `find_existing_match()` correctly merges two near-identical titles from different sources only when an overlapping signal (org/venue/deadline month) is also present, and correctly treats a title-only fuzzy match as new.
**Done when:** Phase 12's `test_component_scorer.py` and `test_fingerprint.py` unit tests pass.

### Phase 5 — Memory layer
**Prompt:** "Implement radar/memory/faculty_profile_store.py: `get_active_profile() -> FacultyProfile` (reads the single row from faculty_profile, computing and caching profile_embedding if it's null), `get_profile_terms(profile_id) -> list[ProfileTerm]` (reads all rows from profile_terms), and `update_profile(keywords, profile_text, terms)` which recomputes and stores the embedding and upserts profile_terms. Implement radar/memory/seen_opportunities_store.py: `is_new(fingerprint: str) -> bool` (checks the opportunities table by fingerprint, per Section 6.3) — this is what prevents repeat alerts."
**Done when:** calling `update_profile()` twice with the same input produces the same embedding both times (determinism check).

### Phase 6 — Governance and orchestrator
**Prompt:** "Implement radar/governance/rules.py exactly as shown in Section 10 of SPEC.md. Then implement radar/orchestrator/pipeline.py exactly following the Watch → Score → Validate → Alert structure in Section 7.4 of SPEC.md, including a `dry_run: bool` parameter that skips the Alert step (no Telegram/email sent, no ICS regenerated) but still writes to the database — this is what lets tests and manual verification runs happen without spamming notifications."
**Done when:** `python -m radar.orchestrator.pipeline` (with `dry_run=True` hardcoded temporarily) runs to completion against your real Supabase project and a real faculty_profile row, and `run_log` shows one row with `status='success'`.

### Phase 7 — Notifications and calendar
**Prompt:** "Implement radar/notify/digest_builder.py: `build(opportunities: list[Opportunity]) -> str` producing the exact markdown digest format shown in samples/sample_digest.md (create that sample file first with 3 fake entries, matching the row format from Section 9.2's wireframe: title, source, one-line fit reason, score, deadline). Implement radar/notify/telegram.py: `send(text: str)` posting to `https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage` with chat_id=TELEGRAM_CHAT_ID and the digest as `text` (Telegram messages max ~4096 chars — split into multiple messages if longer). Implement radar/notify/email_brevo.py: `send(subject, html_body)` posting to `https://api.brevo.com/v3/smtp/email` with header `api-key: BREVO_API_KEY`. Implement radar/calendar/ics_builder.py: `regenerate_and_upload()` — queries all `opportunity_deadlines` rows with `confidence='confirmed'` (never `probable` or `unknown` — an unverified date has no business in someone's calendar), joins to the parent opportunity's title and primary `opportunity_sources.source_url`, builds an .ics calendar using the `ics` package (one VEVENT per confirmed deadline, summary=title, url=source_url), and uploads the resulting file to a public Supabase Storage bucket named `calendars` at path `deadlines.ics`, returning the public URL."
**Done when:** you receive one real Telegram message (or email) from a manual dry_run=False test call, and the resulting `deadlines.ics` URL opens correctly when pasted into a browser (should download/display a valid calendar file).

### Phase 8 — GitHub Actions
**Prompt:** "Create .github/workflows/pipeline.yml exactly as shown in Section 7.4 of SPEC.md." (No AI needed for logic here — this is copy-paste, but let the tool wire in your actual secret names if you deviated from Section 7.2.)
**Verify:** add all secrets in GitHub repo Settings → Secrets and variables → Actions first. Then trigger the workflow manually once via the Actions tab ("Run workflow" button, this uses `workflow_dispatch`) before waiting for the schedule.
**Done when:** the manual run shows a green checkmark and a new `run_log` row appears in Supabase.

### Phase 9 — MCP server and prompt command
**Prompt:** "Create mcp_server.py exactly as shown in Section 11.1 of SPEC.md. Create prompts/weekly_scan.md exactly as shown in Section 11 of SPEC.md, with the faculty member's real name/department/institution/keywords substituted for the `{{...}}` placeholders once you have a real faculty_profile row."
**Verify:** run `python mcp_server.py` locally and connect to it from an MCP Inspector or your AI tool's MCP settings; call `watch_journals` with a test field and confirm it returns real data.
**Done when:** all three tools are callable and return data matching what the pipeline itself produces.

### Phase 10 — Frontend scaffold and design system
**Prompt:** "Scaffold a Next.js 14+ App Router project in web/ with TypeScript and Tailwind. Create web/styles/tokens.css defining CSS custom properties for exactly the 6 colors in Section 9.2 of SPEC.md (--color-ink, --color-panel, --color-parchment, --color-brass, --color-verdigris, --color-rust), and configure tailwind.config.ts to reference them. Add the Fraunces, Public Sans, and Spline Sans Mono fonts (via next/font/google or self-hosted) and set them as --font-display, --font-body, --font-numeric CSS variables. Do not use any pre-built component library (no shadcn/ui, no Material UI) — build components from scratch using these tokens so the visual identity in Section 9 is fully realized, not a themed default."
**Verify:** open the dev server and visually confirm the page background is genuinely Ink, not a default white/gray, and that both font families are visibly distinct from each other and from system-default sans.
**Done when:** a static, unstyled-data version of the dashboard wireframe from Section 9.2 renders with the correct fonts and colors, before any real data is wired in.

### Phase 11 — Frontend pages and API routes
**Prompt:** "Implement the API routes in Section 8 of SPEC.md under web/app/api/, each validating its input/output with zod, using web/lib/supabaseServerClient.ts (service-role key, server-only, never imported into a 'use client' file). Then implement the six pages listed in Section 9.3, wiring each to its corresponding API route, following the layout and empty-state copy described in Section 9.2. The dashboard's radar-sweep loading indicator must respect `prefers-reduced-motion`."
**Verify:** manually click through every page once with real (even if sparse) data from Supabase; manually trigger the empty state on `/` by temporarily setting `min_relevance_band` to `high`, and confirm the written-in-voice empty-state text (Section 9.2) appears rather than a blank list.
**Done when:** all six pages load without console errors and the "pursue/dismiss" action on an opportunity detail page correctly updates `opportunity_status` and is reflected on next page load.

### Phase 12 — Testing (see Section 13 for the full plan)
**Prompt:** "Implement every test file listed in Section 13's test matrix. Python tests use pytest with the `responses` library to mock all HTTP calls — no test may make a real network call. Frontend unit tests use Vitest + React Testing Library. E2E tests use Playwright against a local dev server with a seeded test database (a separate, throwaway Supabase project or a local Postgres with the same schema)."
**Done when:** `pytest` and the frontend `npm test` both exit 0, and the CI workflow (frontend-ci.yml) is green on a push.

### Phase 13 — Deployment
See Section 14 for the exact steps. **Done when:** all 6 items in Section 2's project-level Definition of Done are checked off against the live, deployed system — not just localhost.

### Phase 14 — Optional advanced extension: graph-based relevance
Since the scoring problem is naturally a link-prediction task (faculty ↔ topic ↔ venue/funder), and this is squarely in graph-neural-network territory, an optional stretch goal once the MVP (Phases 0–13) is fully working and tested: build a small heterogeneous graph (faculty nodes, keyword nodes, venue/funder nodes, edges from co-occurring keywords and from OpenAlex's own concept graph) and train a lightweight GNN link-predictor (e.g., a two-layer GraphSAGE in PyTorch Geometric) as an alternative `model_version` value in `scoring_log` (e.g. `'gnn-v1'` alongside `'component-v1'`), A/B-able against the component-based baseline from Section 6.2 while keeping the same explanation-object contract. This is explicitly optional and should only be attempted after the MVP definition of done is fully met — do not let it block the core deliverables.

---

## 13. Testing and QA plan

### 13.1 Unit tests (pytest, no network)

| Test file | What it checks |
|---|---|
| `test_fingerprint.py` | Same title/agency/DOI in different casing/whitespace produces the same fingerprint; a different DOI produces a different fingerprint; `find_existing_match()` merges on stages 1–4 with exact identifiers; stage 5 merges only when both the fuzzy-score bound *and* an overlapping signal are present, and does **not** merge on fuzzy title alone |
| `test_component_scorer.py` | Related texts score higher `topic_similarity` than unrelated texts; a profile term present verbatim in the opportunity text raises `exact_term_match`; a negative term caps the penalty at 25; `final_score` is deterministic across two calls with identical inputs; `score_band()` maps 80/65/50/0 boundaries to the correct band names |
| `test_deadline_engine.py` | `deadline_urgency()` returns the correct bucket at each boundary (3/7/14/30 days); a `confidence='unknown'` or `'probable'` deadline yields `deadline_actionability=0` regardless of proximity; a re-scanned date that differs from a previously `confirmed` row is classified `changed` |
| `test_governance_rules.py` | Missing `source_url` is rejected; NaN score is rejected; past-**confirmed**-deadline funding item is rejected; an item with only an `unknown`-confidence deadline is **not** rejected on deadline grounds; a fully valid item is accepted |
| `test_ics_builder.py` | Generated `.ics` text is parseable by the `ics` library round-trip; an `opportunity_deadlines` row with `confidence` other than `confirmed` is excluded from the calendar |

### 13.2 Integration tests (pytest, HTTP mocked with `responses`)

| Test file | What it checks |
|---|---|
| `test_openalex_client.py` | A mocked 200 response is parsed correctly; a mocked 429 triggers exactly the configured retry count then raises; a missing `api_key` env var raises a clear config error before any HTTP call is made |
| `test_grants_gov_client.py` | POST body matches the documented shape; `data.oppHits` missing from the response is handled as an empty list, not a crash |
| `test_pipeline_end_to_end.py` | Full `run_pipeline(dry_run=True)` against a test database and fully mocked source clients: run twice with identical mocked data → second run produces `opportunities_new == 0` (dedup proven, and `opportunity_sources.last_seen_at` advances instead of a duplicate row appearing); a source client raising an exception still lets the run finish with `status='partial_failure'`, produces a `source_runs` row with `status='failed'` for that source only, and the other sources' `source_runs` rows and data are present and unaffected |

### 13.3 Frontend tests (Vitest + React Testing Library)
- Each API route: valid input → correct shape; invalid input → 400 with field errors.
- Dashboard: renders the written empty-state copy when the API returns zero opportunities; renders rows correctly when it returns data; the "pursue" button optimistically updates before the server confirms, and rolls back visually if the server call fails.

### 13.4 End-to-end tests (Playwright)
1. Load `/`, confirm the page title and at least one opportunity row (against seeded test data) are visible.
2. Click into an opportunity, click "Mark as pursuing," navigate back, confirm the dashboard reflects the new status.
3. Navigate to `/deadlines`, confirm the "Subscribe to calendar" link points at a URL ending in `.ics`.
4. Navigate to `/activity`, confirm the most recent seeded `run_log` entry is visible with its found/new counts.

### 13.5 Edge-case matrix

| Scenario | Expected behavior |
|---|---|
| One of the three watch APIs is down/times out | Pipeline still completes using the other sources; the failure is recorded in `run_log.errors`, not swallowed silently and not fatal |
| Semantic Scholar returns HTTP 429 | Client backs off per Section 7.5 and retries; if still failing after 3 attempts, that source's results are simply empty for this run |
| Duplicate opportunity found on two different runs | The `opportunities.fingerprint` unique constraint prevents a second row; `find_existing_match()` catches it first at the application level and instead updates/inserts an `opportunity_sources` row; `opportunities_new` for that run is 0 for that item |
| Same opportunity reported by two different sources on the same run | Both sources' `opportunity_sources` rows exist against the **same** `opportunities.id` (never two opportunity rows) — this is what the fuzzy-match-plus-overlapping-signal rule in Section 6.3 stage 5 is specifically for |
| Faculty profile has zero keywords or zero `profile_terms` | `journal_watch` loop has nothing to iterate — pipeline logs a warning and still runs `funding_deadline_scan`; the component scorer falls back to `topic_similarity` alone (other components return 0, not an error); UI shows a specific empty-state message telling the faculty member to add keywords/terms in `/profile` |
| Opportunity title contains non-English characters | Embedding model handles multilingual input natively (MiniLM's underlying training includes non-English text) — no special-casing needed, but add one test case with a non-ASCII title to confirm no encoding crash |
| Deadline date is malformed in a source's raw response | Parsing wraps `datetime.strptime` in try/except; on failure, the `opportunity_deadlines` row is still written, with `confidence='unknown'` and `raw_text` set to the original string, rather than crashing the whole item or fabricating a date (Section 6.4) |
| A previously `confirmed` deadline changes on re-scan | The existing `opportunity_deadlines` row is updated to `confidence='changed'`, a `deadline_changed` alert fires (subject to `alerts_sent.dedupe_key`), and pending deadline alerts for that opportunity are re-evaluated against the new date |
| Two pipeline runs overlap (e.g., manual trigger during a scheduled run) | Each run gets its own `run_log` row and its own set of `source_runs` rows; the `fingerprint` unique constraint at the database level (not application-level locking) is what actually prevents duplicate opportunity data even under a race |
| Timezone/DST around the cron schedule | Cron times in GitHub Actions are UTC; deadlines are stored as plain `date` (no time-of-day, no timezone) specifically to avoid DST edge cases entirely — a deadline is "that calendar day," not a timestamp |
| GitHub public-repo schedule silently stops firing | GitHub disables `schedule` triggers on repos with **60 days of no commit activity** — because this repo is under active development this is unlikely, but if you leave it dormant post-submission, do one `workflow_dispatch` manually or make a trivial commit to re-arm it |

### 13.6 Manual QA checklist (run once before calling the project "done")
- [ ] Real end-to-end run against real APIs (not mocked) completes and produces at least 10 opportunities
- [ ] At least 2 different `source_name` values appear in the results (proves multi-source ingestion actually works, not just one API)
- [ ] Telegram or email notification actually arrives on a phone/inbox
- [ ] `.ics` file opens correctly in an actual calendar app, not just a text viewer
- [ ] Dashboard is checked in both light-OS and dark-OS mode (the app is dark-themed by design regardless of OS setting — confirm this is intentional and not an unstyled fallback)
- [ ] Mobile viewport (browser dev tools, 375px width) — right rail collapses correctly, no horizontal scroll

### 13.7 Bug tracking
Use GitHub Issues on the same repo with three labels: `bug`, `governance` (anything touching Section 10's checklist), `data-quality` (bad/missing data from a source, not a code bug). Every bug fix references its issue number in the commit message.

---

## 14. Deployment plan

1. **Supabase:** create project → run `radar/db/schema.sql` in the SQL editor → create a public Storage bucket named `calendars` → copy the project URL and `service_role` key into GitHub Secrets and (for `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` only) Vercel env vars.
2. **GitHub Secrets:** add every value from Section 7.2 under Settings → Secrets and variables → Actions.
3. **First manual pipeline run:** Actions tab → `opportunity-radar-pipeline` → "Run workflow" → confirm green, then check Supabase Table Editor for new `opportunities` rows.
4. **Vercel:** import the GitHub repo, set the root directory to `web/`, add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as environment variables, deploy.
5. **Verify live:** open the deployed URL, confirm real data appears (not a local-only test).
6. **Re-check the schedule:** wait for (or manually trigger) a second run on a different day; confirm `opportunities_new` is lower than the first run's `opportunities_found` (proof dedup is working against real, not mocked, data).

---

## 15. Security and privacy notes
- `SUPABASE_SERVICE_ROLE_KEY` bypasses all Row Level Security — it must **never** appear in any file under `web/app/**` that is a Client Component, never in a NEXT_PUBLIC_ prefixed variable, and never committed to git.
- `.env` is git-ignored from Phase 1 onward; double-check with `git status` before your first commit.
- The manual `/api/pipeline/trigger` route (if built) must check a shared secret header before calling GitHub's API, so a random visitor to the deployed URL cannot spam-trigger your pipeline.
- The faculty profile in this build is not sensitive personal data (name, department, research keywords are already public academic information), so no additional encryption is required beyond what Supabase provides by default — but still keep the repo's `/samples` data synthetic, not the real faculty member's actual profile, since the repo is public.
- Rotate the Telegram bot token and Brevo API key if either is ever accidentally committed — both are trivially revocable and free to regenerate.

---

## 16. Deliverables — mapped back to the brief

| Brief deliverable | Where it lives in this build |
|---|---|
| Weekly opportunity digest sample | `samples/sample_digest.md` (Phase 7) + live version at `/digests` in the deployed app, generated fresh by `digest_builder.build()` on every alerting run |
| Relevance-scoring log | The `scoring_log` table (Section 6.1), append-only, storing the full component breakdown and band per score (Section 6.2); visible per-opportunity on `/opportunities/[id]` and exportable via `GET /api/opportunities/:id` |
| Proposal-deadline calendar | `deadlines.ics` regenerated every run and hosted on Supabase Storage; subscribable link surfaced on `/deadlines` |
| Reusable prompt command | `prompts/weekly_scan.md` (Section 11), directly usable with the MCP tools in `mcp_server.py` |

---

## 17. Appendix

### 17.1 Glossary
- **MCP (Model Context Protocol):** an open standard/SDK (published by Anthropic) for exposing functions ("tools") to any compatible chat client, so an LLM can call real code rather than only generate text.
- **pgvector:** a Postgres extension adding a `vector` column type and similarity operators, used here to store and (optionally) query embeddings directly in the database.
- **Cosine similarity:** a measure of how similar two vectors' directions are, ranging from -1 (opposite) to 1 (identical); used here to compare an opportunity's text embedding to the faculty profile's text embedding.
- **Polite pool:** Crossref/OpenAlex's historical term for a faster-served tier of API traffic identified by a contact email; OpenAlex replaced this with mandatory API keys in Feb 2026 (Section 4.1), Crossref still uses it as described (Section 4.2).
- **PostgREST:** the component Supabase uses to auto-generate a REST API directly from your Postgres schema; this build bypasses it by using the `supabase-py`/`supabase-js` clients with the service-role key instead of relying on PostgREST's anon/authenticated grants.
- **Idempotent:** running the same operation twice produces the same end state as running it once — the property that makes the dedup design safe to re-run on a schedule.
- **Fingerprint:** the multi-stage dedup identifier from Section 6.3 (`opportunities.fingerprint`) — distinct from a simple hash because it's only assigned *after* `find_existing_match()` has tried all five matching stages, not computed blindly from one field combination.
- **Band:** one of `high` / `strong` / `watch` / `low` / `not_eligible` — the human-readable relevance category a numeric score (0–100) maps to (Section 6.2), used everywhere instead of a raw float so the UI and alert policy never have to reinterpret a bare number.
- **Deadline confidence:** the per-`opportunity_deadlines`-row state (`confirmed` / `probable` / `unknown` / `closed` / `changed`, Section 6.4) that governs whether a date is allowed to drive alerts or appear on the `.ics` calendar — the mechanism that keeps the system from ever presenting a guess as a fact.
- **Provenance:** the `opportunity_sources` table's record of every source that has reported a given opportunity, with `first_seen_at`/`last_seen_at` per source — what lets the UI honestly show "discovered via X, also seen via Y" instead of picking one source arbitrarily.

### 17.2 Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| OpenAlex requests return 401/403 | Missing or invalid `api_key` param | Confirm the key was copied from `openalex.org/settings/api`, not left as a placeholder; confirm it's passed as a query param, not a header |
| Pipeline run in GitHub Actions never starts on schedule | Repo is private, or public repo has gone 60+ days without a commit | Make the repo public (Section 7.4); make any commit, or run `workflow_dispatch` manually, to re-arm a dormant schedule |
| Supabase queries suddenly fail with "project paused" | 7+ days since last activity on the free tier | Resume manually from the Supabase dashboard; confirm the pipeline schedule (twice weekly) is actually running |
| `.ics` file downloads but calendar apps reject it | Malformed VEVENT (usually a bad date format) | Validate the generated file with the `ics` library's own parser before uploading; add the malformed-date test case from Section 13.5 |
| Relevance scores are all clustered near 0.5 with no spread | Profile `profile_text` is too short/generic (e.g., just a job title) | Write a fuller, keyword-rich `profile_text` — a couple of sentences describing actual research topics, not just a title |
| Telegram message never arrives | Bot has no chat history with your account yet | Send the bot any message first, then call `getUpdates` once to find your numeric `chat_id`, and use that exact value |
| Duplicate opportunities appear in the dashboard | `fingerprint` calculated inconsistently between runs (e.g., whitespace differences not normalized), or `find_existing_match()` not called before insert | Re-check `normalize()` in `radar/dedup/fingerprint.py` is applied identically everywhere the fingerprint is computed — there should be exactly one function that does this, imported everywhere, never re-implemented inline; confirm every insert path calls `find_existing_match()` first |
| A real duplicate isn't being caught even though titles look identical | The two items differ in `agency_or_publisher` normalization (e.g. "IEEE" vs "IEEE Xplore"), which changes stages 1–4's exact match and falls through to stage 5's fuzzy-plus-signal requirement | Check whether an overlapping signal (org/venue/deadline month) is actually present — Section 6.3 deliberately refuses to merge on title similarity alone, so this can be correct behavior, not a bug; if the two agency names genuinely refer to the same funder, add a normalization alias rather than loosening the fuzzy threshold |

### 17.3 requirements.txt (Python)
```
requests>=2.31
httpx>=0.27
sentence-transformers>=3.0
numpy>=1.26
rapidfuzz>=3.9
supabase>=2.4
python-dotenv>=1.0
pydantic>=2.7
ics>=0.7
mcp>=1.0
tenacity>=8.2
beautifulsoup4>=4.12
pytest>=8.0
pytest-mock>=3.14
responses>=0.25
```

### 17.4 Key frontend dependencies (web/package.json)
```
next, react, react-dom, typescript, tailwindcss,
@supabase/supabase-js, swr, zod, date-fns,
vitest, @testing-library/react, @playwright/test
```

---

*End of specification. Keep this file updated as `SPEC.md` in the repo root as you build — if reality and this document diverge, treat that as a bug to fix in one or the other, not something to leave unreconciled.*
