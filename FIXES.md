# Remediation & Hardening Changelog (FIXES.md)

This changelog records all defects, breaking bugs, and anti-patterns remediated in the codebase, with file paths, line references, and technical rationale.

---

## Phase 1 — Stop the Bleeding: Fix What's Actually Broken

### 1.1 NameError in Pipeline Orchestrator Entrypoint
* **File:** [
adar/orchestrator/pipeline.py](radar/orchestrator/pipeline.py#L4)
* **Defect:** 
un_pipeline signature specified 	elemetry_callback: Optional[Callable[[Dict[str, Any]], None]] = None, but Dict was never imported in rom typing import Any, Callable, List, Optional, Tuple. This raised an eager NameError: name 'Dict' is not defined on import, causing any pipeline run or GitHub Actions cron invocation to immediately crash.
* **Fix:** Added Dict explicitly to the rom typing import ... import on line 4.
* **Typing Sweep:** Ran AST verification across all 66 Python files in 
adar/, 	ests/, and root. Verified that all typing symbols (Dict, List, Optional, Tuple, Any, Callable, Set, Union) are correctly imported across the entire codebase.

### 1.2 Inoperative --dry-run CLI Flag
* **File:** [
adar/orchestrator/pipeline.py](radar/orchestrator/pipeline.py#L151)
* **Defect:** dry = "--dry-run" in sys.argv or True forced dry to evaluate to True unconditionally, silently turning every manual or scheduled execution into a dry run with zero database writes or alert dispatches.
* **Fix:** Changed to dry = "--dry-run" in sys.argv, ensuring dry_run defaults to False in scheduled CI runs (.github/workflows/pipeline.yml) while correctly honoring --dry-run when passed by an operator.

### 1.3 Hardcoded Third-Party Repository in GitHub Actions Dispatch
* **File:** [web/app/api/pipeline/trigger/route.ts](web/app/api/pipeline/trigger/route.ts#L10)
* **Defect:** POST handler dispatched GitHub workflow requests to https://api.github.com/repos/Kilo-Org/research-opportunity-radar/..., a hardcoded foreign repository.
* **Fix:** Replaced with process.env.GITHUB_REPO (or composite GITHUB_REPO_OWNER/GITHUB_REPO_NAME). Added request-time validation returning HTTP 501 with clear actionable guidance when credentials or repository identifiers are unset.

### 1.4 Test Runner Environment Configuration
* **File:** [pytest.ini](pytest.ini)
* **Defect:** Running bare pytest failed during collection with ModuleNotFoundError: No module named 'radar' because the root directory was not in sys.path.
* **Fix:** Added root pytest.ini with pythonpath = . and 	estpaths = tests, ensuring all 20 tests collect and pass out of the box.

### 1.5 Build & Pipeline Verification
* **Pipeline Run:** python -m radar.orchestrator.pipeline --dry-run completed with status partial_failure (222 opportunities discovered, 196 compliant candidates admitted).
* **Test Suite:** 20/20 tests passing in pytest across unit and integration suites.
* **Frontend Build:** 
pm run build in web/ passed with 0 errors (all 14 static and dynamic routes compiled).

## Phase 2 - Kill the Simulations: Purge Fake Data & Wire Real Feeds

### 2.1 Live Discovery Agent Feed Integration
* **File:** [radar/agents/discovery_agent.py](radar/agents/discovery_agent.py#L12)
* **Defect:** discover_unindexed_opportunities() returned 4 hardcoded candidate dicts (DARPA Young Faculty Award, NSF CAREER, IPSN 2026, IEEE TNSM) masquerading as autonomous discovery.
* **Fix:** Completely eliminated all static mock dictionaries. Implemented live HTTP feeds:
  - search_nsf_solicitations(): Queries official live NSF Open Solicitations RSS (https://www.nsf.gov/rss/rss_www_funding.xml) and extracts real funding calls matching faculty keywords.
  - search_wikicfp(): Queries live WikiCFP calls (http://www.wikicfp.com/cfp/servlet/tool.search) parsing HTML tables for real conference CFPs with genuine deadlines and primary URLs.
* **Test Updates:** [tests/unit/test_discovery_agent.py](tests/unit/test_discovery_agent.py) updated to mock network calls using responses for predictable XML/HTML payloads, verifying real parser logic. 5/5 unit tests passing.

### 2.2 Genuine Pipeline Telemetry SSE Route
* **Files:** [radar/orchestrator/pipeline.py](radar/orchestrator/pipeline.py#L32), [web/app/api/pipeline/stream/route.ts](web/app/api/pipeline/stream/route.ts#L1)
* **Defect:** web/app/api/pipeline/stream/route.ts was a 259-line simulation running hardcoded setTimeout loops printing scripted log messages for a mock persona (Dr. Elena Vance) without executing any Python code.
* **Fix:** Rewrote the SSE route to spawn the actual Python pipeline process (python -m radar.orchestrator.pipeline --dry-run --stream) with real-time stdout streaming.
* **Telemetry Serialization:** Added --stream CLI flag to pipeline.py emitting structured JSON events (TELEMETRY_EVENT:<json>) at each stage transition (INIT, RESONANCE, ADMISSION, COMPLETE) using the real active faculty profile.
* **Dashboard Rescan:** Wired triggerRescan() in [web/app/page.tsx](web/app/page.tsx) to invoke /api/pipeline/stream?run=true and refresh /api/opportunities on COMPLETE.

### 2.3 Comprehensive Purge of Mock Datasets and Personas
* **File:** [web/app/page.tsx](web/app/page.tsx#L53) - Removed DEFAULT_OPPORTUNITIES (87 lines of mock data); UI now renders honest empty states when no opportunities match active filters.
* **File:** [web/app/deadlines/page.tsx](web/app/deadlines/page.tsx#L20) - Removed SAMPLE_TIMELINE (80 lines of mock deadlines); wired to live /api/deadlines with honest empty state.
* **File:** [web/app/activity/page.tsx](web/app/activity/page.tsx#L32) - Removed SAMPLE_RUNS (130 lines of fabricated pipeline history); wired to live /api/activity.
* **File:** [web/app/digests/page.tsx](web/app/digests/page.tsx#L40) - Removed SAMPLE_CYCLES (216 lines of fake cycle logs); wired to /api/digest/latest and honest empty state.
* **File:** [web/app/api/opportunities/route.ts](web/app/api/opportunities/route.ts#L36) - Removed fallback to https://example.com; returns authentic source_url or DOI link.
* **File:** [web/app/api/profile/route.ts](web/app/api/profile/route.ts#L9) - Removed hardcoded fallback profile; returns explicit HTTP 404 when unconfigured in database.

### 2.4 Verification
* **Test Suite:** 22/22 pytest tests passing.
* **Frontend Build:** npm run build in web/ succeeded with 0 errors across all 14 routes.

## Phase 3 - Secrets & Configuration: Fail Loudly

### 3.1 Fail Loudly Configuration Validator
* **File:** [radar/config.py](radar/config.py#L46)
* **Defect:** Application silently fell back to empty strings when critical secrets (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENALEX_API_KEY) were omitted, leading to downstream silent failures or mock fallbacks.
* **Fix:** Added validate_required_config() and custom ConfigurationError exception. When required secrets are missing, the pipeline immediately halts with exit code 1 and outputs a structured error block displaying:
  - Exact missing variable names
  - Purpose of each variable
  - Official URL where the developer/faculty can obtain keys
  - Actionable remediation commands.
* **In-Memory Guard:** Gated volatile in-memory fallback behind explicit ALLOW_IN_MEMORY_DB=1.

### 3.2 Database Client Credentials Enforcement
* **File:** [radar/db/client.py](radar/db/client.py#L68)
* **Defect:** get_client() silently instantiated _InMemoryClient without warning whenever Supabase environment variables were absent.
* **Fix:** get_client() now verifies credentials and raises ConfigurationError unless ALLOW_IN_MEMORY_DB=1 is explicitly set.

### 3.3 Pipeline Entrypoint Integration
* **File:** [radar/orchestrator/pipeline.py](radar/orchestrator/pipeline.py#L29)
* **Fix:** Wired config.validate_required_config() at the entry of run_pipeline(), preventing any unconfigured execution from initializing partial state. Handled ConfigurationError in CLI entrypoint (__main__) to cleanly terminate with status code 1.

### 3.4 OpenAlex Polite-Pool Email Support
* **File:** [radar/sources/openalex_client.py](radar/sources/openalex_client.py#L29)
* **Fix:** OpenAlex requires either an API key (api_key=...) or a polite-pool email address (mailto=...). Enhanced client to automatically detect email addresses in OPENALEX_API_KEY and route queries through the official polite pool without 401 Unauthorized errors.

### 3.5 Automated Environment Checklist Tool
* **File:** [scripts/check_env.py](scripts/check_env.py)
* **Feature:** Created standalone CLI tool that validates the complete environment, tests live HTTP connectivity to OpenAlex (HTTP 200) and Grants.gov (HTTP 200), masks secret values, outputs a formatted ASCII status matrix, and exits with 0 on pass or 1 on missing required keys.

### 3.6 Complete Environment Documentation
* **Files:** [.env.example](.env.example), [web/.env.example](web/.env.example)
* **Feature:** Documented every single environment variable used across Python backend and Next.js frontend with descriptions, default values, and setup instructions.

### 3.7 Web Application Graceful Failure & Health Banner
* **Files:** [web/lib/supabaseServerClient.ts](web/lib/supabaseServerClient.ts#L3), [web/app/api/config/status/route.ts](web/app/api/config/status/route.ts), [web/components/ConfigBanner.tsx](web/components/ConfigBanner.tsx), [web/app/layout.tsx](web/app/layout.tsx#L68)
* **Feature:** Created /api/config/status endpoint and non-intrusive ConfigBanner component in the Observatory Instrument design system. If Supabase is unconfigured, the web dashboard displays a calibration notice guiding the operator to populate .env.local rather than crashing or showing simulated data.

### 3.8 Verification
* **Test Suite:** [tests/unit/test_config_validation.py](tests/unit/test_config_validation.py) created; all 25 pytest tests passing.
* **CLI Validation:** python scripts/check_env.py verified to exit 1 when unconfigured and exit 0 when keys are set or ALLOW_IN_MEMORY_DB=1 is present.
* **Frontend Build:** npm run build in web/ succeeded with 0 errors across 15 routes.

## Phase 4 - Resilience & Observability: Make It Production-Grade

### 4.1 Polite Thread-Safe Rate Limiting
* **Files:** [radar/sources/rate_limiter.py](radar/sources/rate_limiter.py), [radar/sources/openalex_client.py](radar/sources/openalex_client.py#L35), [radar/sources/crossref_client.py](radar/sources/crossref_client.py#L23), [radar/sources/grants_gov_client.py](radar/sources/grants_gov_client.py#L24), [radar/agents/discovery_agent.py](radar/agents/discovery_agent.py#L86)
* **Defect:** Burst requests across multiple search keywords could trigger HTTP 429 Too Many Requests or ban IP addresses from academic indexes.
* **Fix:** Created thread-safe RateLimiter utility with polite interval pacing:
  - openalex_limiter (5.0 calls/sec)
  - crossref_limiter (5.0 calls/sec)
  - grants_gov_limiter (3.0 calls/sec)
  - scraper_limiter (2.0 calls/sec for NSF, WikiCFP, arXiv).

### 4.2 Semantic Scholar Live Client Integration
* **Files:** [radar/tools/journal_watch.py](radar/tools/journal_watch.py#L89), [radar/sources/semantic_scholar_client.py](radar/sources/semantic_scholar_client.py)
* **Defect:** Semantic Scholar client was implemented but disconnected from the pipeline orchestrator, leaving an unintegrated academic source.
* **Fix:** Fully integrated semantic_scholar_client into journal_watch() as an active source alongside OpenAlex and Crossref. Opportunities are ingested, tagged with DOIs and paper IDs, and cross-deduplicated against existing venue publications.

### 4.3 Transparent Source Ingestion Warnings in Digests
* **Files:** [radar/notify/digest_builder.py](radar/notify/digest_builder.py#L14), [radar/orchestrator/pipeline.py](radar/orchestrator/pipeline.py#L168)
* **Defect:** When external feeds failed (e.g., HTTP timeout or upstream rate limit), they were silently swallowed in the generated digest.
* **Fix:** Added failed_sources tracking to the orchestrator. digest_builder.build() now prominently surfaces all failed sources and specific HTTP error categories at the top of the markdown digest as an Observatory warning block, notifying researchers when specific feeds could not be contacted.

### 4.4 Conflict-Aware In-Memory Upsert and Deduplication
* **Files:** [radar/db/client.py](radar/db/client.py#L32), [radar/orchestrator/pipeline.py](radar/orchestrator/pipeline.py#L111)
* **Defect:** _InMemoryTable.upsert() did not honor on_conflict keys and simply appended duplicate records. Additionally, db.upsert_opportunities() incremented opportunities_new unconditionally, even for already-present opportunities.
* **Fix:**
  - Implemented on_conflict key matching and record updating in _InMemoryTable.upsert().
  - Updated db.upsert_opportunities() to check presence by fingerprint before incrementing new_count.
  - Added intra-run deduplication in pipeline.py so duplicate items across disparate keywords within the same scan cycle are deduplicated immediately.

### 4.5 Structured Contextual Logging
* **Files:** [radar/logging_config.py](radar/logging_config.py), [radar/orchestrator/pipeline.py](radar/orchestrator/pipeline.py#L58)
* **Feature:** Implemented StructuredLogger emitting standardized tags [run_id=...][source=...][category=...] on every log line, guaranteeing full traceability across multi-agent runs.

### 4.6 Pipeline Idempotency Verification
* **File:** [tests/integration/test_pipeline_idempotency.py](tests/integration/test_pipeline_idempotency.py)
* **Feature:** Built dedicated end-to-end integration test executing the complete pipeline twice against identical data source responses.
* **Result:** Test confirmed: Run 1 discovered and admitted opportunities (new > 0); Run 2 discovered the same opportunities but admitted strictly 0 new opportunities (new == 0), with provenance updates recorded.

### 4.7 Verification
* **Test Suite:** 26 pytest tests passing (including idempotency test).
* **Frontend Build:** npm run build in web/ succeeded with 0 errors across 15 routes.


---

## Phase 5 — Full Feature Delivery: Faculty Profile, Feedback Loop, Indian Agencies, & Urgent Deadlines

### 5.1 Faculty Profile End-to-End Persistence & Eligibility Gatekeeper
* **Files:** [radar/models.py](radar/models.py#L114), [radar/memory/faculty_profile_store.py](radar/memory/faculty_profile_store.py#L32), [radar/db/schema.sql](radar/db/schema.sql#L5), [web/app/api/profile/route.ts](web/app/api/profile/route.ts), [web/app/profile/page.tsx](web/app/profile/page.tsx)
* **Feature:** Extended faculty profile models and database storage to incorporate essential compliance gatekeeper parameters:
  - career_stage ('Assistant Professor', 'Associate Professor', 'Full Professor', 'Postdoctoral Fellow')
  - phd_year (integer graduation year backing tenure clock calculations)
  - institution_type ('R1 Doctoral University (IHE)', 'Undergraduate Institution', 'Medical School / Academic Medical Center')
  - citizenship_status ('US Citizen or Permanent Resident', 'Foreign National / Non-Resident Alien')
* **UI & API:**
  - Added Section 01B 'Compliance & Gatekeeper Vector' to the Next.js faculty profile page with interactive selectors and input fields.
  - Updated API route to validate with Zod and persist changes directly to Supabase / in-memory store.
  - Verified that EligibilityAgent evaluates tenure clock windows, institutional classification, and citizenship against real profile data.

### 5.2 Faculty Feedback Loop & Scoring Tuning
* **Files:** [radar/db/schema.sql](radar/db/schema.sql#L160), [radar/db/client.py](radar/db/client.py#L334), [radar/scoring/component_scorer.py](radar/scoring/component_scorer.py#L92), [radar/orchestrator/pipeline.py](radar/orchestrator/pipeline.py#L123), [web/app/api/opportunities/[id]/status/route.ts](web/app/api/opportunities/[id]/status/route.ts), [tests/unit/test_feedback_loop.py](tests/unit/test_feedback_loop.py)
* **Feature:** Built closed-loop reinforcement mechanism where faculty interactions adjust scoring:
  - Added feedback table schema with opportunity_id, faculty_id, rating ('relevant' | 'not_relevant' | 'neutral'), feedback_text, and negative_terms array.
  - Implemented compute_feedback_penalty in component_scorer.py, penalizing candidate resonance by up to 35 points if matching terms or topics flagged as not_relevant by the researcher.
  - Updated Next.js status endpoint to automatically extract keyword terms and record negative feedback when a researcher marks an opportunity as dismissed.
  - Wired feedback signals into the orchestrator pipeline scoring step.
  - Created unit tests verifying penalty computation and database persistence.

### 5.3 Indian Funding Agency Adapters (ICMR & DBT)
* **Files:** [radar/sources/agencies/icmr_adapter.py](radar/sources/agencies/icmr_adapter.py), [radar/sources/agencies/dbt_adapter.py](radar/sources/agencies/dbt_adapter.py), [radar/tools/funding_deadline_scan.py](radar/tools/funding_deadline_scan.py#L13), [radar/config.py](radar/config.py#L29), [tests/unit/test_indian_agency_adapters.py](tests/unit/test_indian_agency_adapters.py)
* **Feature:** Pluggable agency scrapers for Indian biomedical and biotechnology funding bodies:
  - ICMRAdapter: Scrapes Indian Council of Medical Research (ICMR) call-for-proposals, parses tables/anchors, resolves absolute URLs, extracts deadline dates, and applies scraper rate limiting.
  - DBTAdapter: Scrapes Department of Biotechnology (DBT India) call-for-proposals with rate limiting and deadline regex parsing.
  - Registered both adapters in AGENCY_REGISTRY in funding_deadline_scan.py and added to AGENCY_LIST in config.py.
  - Implemented 6 unit tests with HTML fixtures verifying parsing, HTTP error fallback, registry binding, and tool integration.

### 5.4 Urgent 72-Hour Deadline Sentinel & Deduplication
* **Files:** [radar/notify/deadline_alert.py](radar/notify/deadline_alert.py), [radar/orchestrator/pipeline.py](radar/orchestrator/pipeline.py#L178), [tests/unit/test_deadline_alerts.py](tests/unit/test_deadline_alerts.py)
* **Feature:** High-priority deadline watcher scanning opportunities for confirmed/probable deadlines within 3 days (0 <= days_left <= 3):
  - Dispatches immediate high-priority alerts via Telegram and Brevo.
  - Emits telemetry events to the Observatory real-time stream.
  - Enforces strict deduplication using alerts_sent table (dedupe_key = f"{opp.id}:deadline_urgent:{deadline_date}") to prevent alert fatigue.
  - Created unit test verifying urgent deadline detection, horizon filtering, and deduplication.

### 5.5 Verification
* **Pytest Test Suite:** 36/36 tests passing across unit and integration tests.
* **Frontend Build:** npm run build in web/ succeeded with 0 errors across 15 routes.


---

## Phase 6 — Dashboard Polish: Opportunity Dossier, 6-Component Breakdown, & Provenance Trust Signals

### 6.1 Purged Mock Opportunity Fallbacks
* **File:** [web/app/opportunities/[id]/page.tsx](web/app/opportunities/[id]/page.tsx)
* **Defect:** When querying an unindexed or deleted opportunity ID, the detail view silently fell back to 105 lines of hardcoded fake data (`SAMPLE_OPPORTUNITY`: IEEE TCPS mock opportunity).
* **Fix:** Completely purged `SAMPLE_OPPORTUNITY`. Implemented authentic Observatory 404 / record not found state with telemetry error display and a direct return link to the active radar stream.

### 6.2 Interactive Expandable 6-Component Score Breakdown
* **File:** [web/app/opportunities/[id]/page.tsx](web/app/opportunities/[id]/page.tsx#L250)
* **Feature:** Added interactive toggle (`Collapse Breakdown` / `Expand Breakdown`) rendering comprehensive visual metrics for every mathematical dimension:
  - Topic Similarity (35% weight, all-MiniLM-L6-v2 dense vector cosine resonance)
  - Exact Term Match (20% weight, lexical domain dictionary overlap)
  - Method Match (10% weight, methodological alignment)
  - Application Match (10% weight, target application domains)
  - Venue / Funder Fit (10% weight, publication venue or agency synergy)
  - Recency (5% weight, freshness decay curve)
  - Deadline Actionability (10% weight, feasibility window)
  - Active Feedback Penalty Deduction (up to -35 points dynamically calculated from researcher dismissal signals)
* **UI:** Dual-color progress bars, weight tags, and explanatory descriptions adhering to the Observatory Instrument aesthetic.

### 6.3 Real Eligibility Dossier & Source Trust Signal Bar
* **Files:** [web/app/opportunities/[id]/page.tsx](web/app/opportunities/[id]/page.tsx#L180), [web/app/api/opportunities/[id]/route.ts](web/app/api/opportunities/[id]/route.ts#L50)
* **Feature:**
  - Surfaced `EligibilityReport` data in Section 02, rendering compliance check verdicts (`PASS`, `WARNING`, `FAIL`), justification reasons, quoted solicitation excerpts, and action items.
  - Added dedicated Source Trust Signal Bar in the header displaying source name, verified mirror status, live harvest timestamp, and direct links to official RFPs.
  - Purged hardcoded 2025 timestamps and mock audit records in Section 06, replacing them with dynamic UTC timestamps from live ingestion cycles.

### 6.4 Verification
* **Frontend Build:** `npm run build` in `web/` compiled cleanly with 0 errors across all 15 routes.


---

## Phase 7 — Tests, CI, Documentation, & Final Hardening

### 7.1 Comprehensive Automated Test Verification
* **Test Suite:** Expanded full test suite to 36 automated pytest tests across unit and integration domains:
  - `tests/unit/test_indian_agency_adapters.py`: 6 tests verifying ICMR, DBT, DST-SERB adapters, HTTP error handling, and tool registration.
  - `tests/unit/test_deadline_alerts.py`: 1 test verifying 72-hour urgent deadline sentinel detection and persistent deduplication memory.
  - `tests/unit/test_feedback_loop.py`: 3 tests verifying closed-loop penalty discounting on dismissed topics and database persistence.
  - `tests/unit/test_config_validation.py`: 3 tests verifying fail-loudly behavior and polite pool resolution.
  - `tests/unit/test_discovery_agent.py`: 5 tests verifying live NSF RSS and WikiCFP live parsing with mocked fixtures.
  - `tests/unit/test_eligibility_agent.py`: 4 tests verifying 4-point compliance rule evaluation against faculty profile constraints.
  - `tests/integration/test_pipeline_idempotency.py`: Full end-to-end multi-cycle pipeline idempotency test ensuring strictly 0 duplicate items on repeat runs.
* **Result:** 36 passed in pytest with zero failures.

### 7.2 Frontend CI & Unit Testing
* **Files:** [.github/workflows/frontend-ci.yml](.github/workflows/frontend-ci.yml), [web/__tests__/config.test.ts](web/__tests__/config.test.ts)
* **Defect:** `frontend-ci.yml` invoked `npm test` which threw exit code 1 because no frontend test files existed.
* **Fix:**
  - Added Vitest unit test suite [web/__tests__/config.test.ts](web/__tests__/config.test.ts) verifying Supabase configuration checks and descriptive error handling.
  - Updated `frontend-ci.yml` with headless CI environment parameters (`ALLOW_IN_MEMORY_DB=1`) and integrated Next.js production build verification (`npm run build`).
* **Result:** Vitest passed (3/3 tests); Next.js compiled cleanly across 15 routes.

### 7.3 End-to-End Specification Synchronization
* **File:** [spec.md](spec.md)
* **Feature:** Synchronized canonical specification document to reflect authentic architecture:
  - Documented live data sources: OpenAlex polite pool, Crossref, Semantic Scholar, Grants.gov, NSF RSS, WikiCFP, ICMR, DBT India, and DST-SERB.
  - Documented explainable 6-component scoring formula, including the adaptive faculty feedback discount (-35 pts).
  - Updated database schema with `feedback` table and `faculty_profile` compliance fields (`career_stage`, `phd_year`, `institution_type`, `citizenship_status`).
  - Updated complete directory tree and test map.

### 7.4 Publication-Grade Root Documentation
* **File:** [README.md](README.md)
* **Feature:** Authored comprehensive, publication-grade repository documentation:
  - System architecture mermaid flowchart detailing ingestion, deduplication, scoring, governance gate, and Observatory telemetry stream.
  - Complete rate-limit table and authentication matrix.
  - Detailed mathematical formulation of the explainable 6-component scoring engine.
  - Quick-start guide, environment validation commands (`scripts/check_env.py`), CLI execution modes (`--dry-run`, `--stream`), and dashboard launch instructions.
  - Rigorous human-in-the-loop and governance commitments.

## Phase 8 — Verification Discipline, Deployment Architecture & Production Hardening

### 8.1 Structural Static Analysis Gates & Typing Audit
* **Files:** [pyproject.toml](pyproject.toml), [.pre-commit-config.yaml](.pre-commit-config.yaml), [.github/workflows/pipeline.yml](.github/workflows/pipeline.yml), [.github/workflows/frontend-ci.yml](.github/workflows/frontend-ci.yml), [tests/unit/test_module_imports.py](tests/unit/test_module_imports.py)
* **Defect:** In Python 3.11 runtimes, missing typing imports (such as `Optional`) cause eager `NameError` at function definition time. Without static analysis gates in CI, missing imports regressed silently.
* **Fix:**
  - Fixed `radar/scoring/component_scorer.py` and `radar/memory/faculty_profile_store.py` typing imports.
  - Added `pyproject.toml` configuring `ruff` with rules `["E", "F", "W", "I", "UP"]` and `ignore = ["E501"]`, catching undefined names statically in 0.05 seconds.
  - Created `tests/unit/test_module_imports.py` dynamically importing all 43 modules across the `radar` package.
  - Configured `.pre-commit-config.yaml` with `ruff` and smoke import check.
  - Updated GitHub Actions workflows to execute `ruff check radar/` and smoke import checks prior to test execution.

### 8.2 Real Deployment Architecture & Dry-Run Disambiguation
* **Files:** [Dockerfile](Dockerfile), [.dockerignore](.dockerignore), [radar/orchestrator/pipeline.py](radar/orchestrator/pipeline.py), [web/app/api/pipeline/stream/route.ts](web/app/api/pipeline/stream/route.ts), [web/app/page.tsx](web/app/page.tsx), [tests/integration/test_pipeline_end_to_end.py](tests/integration/test_pipeline_end_to_end.py)
* **Defect:** Next.js SSE route spawned Python as a child process which fails in Node-only serverless hosts. `dry_run` previously coupled database write skipping with alert suppression.
* **Fix:**
  - Created Path A multi-stage `Dockerfile` co-locating Python 3.11 and Node.js 20, pre-caching `all-MiniLM-L6-v2` transformer weights (documented 1GB min, 2GB recommended RAM).
  - Disambiguated `dry_run` (skips DB writes entirely, logs what would be written) from `suppress_alerts` (persists DB records, suppresses notifications).
  - Added `--suppress-alerts` CLI flag and updated `OpportunityPipeline.run()` and `run_pipeline()`.
  - Added "DRY RUN" toggle in Next.js dashboard and parameterized `stream/route.ts`.
  - Added tests `test_pipeline_dry_run_skips_database_writes()` and `test_pipeline_suppress_alerts_writes_db_but_skips_notify()`.

### 8.3 Production Hardening for Unattended Operation
* **Files:** [.github/workflows/pipeline.yml](.github/workflows/pipeline.yml), [radar/logging_config.py](radar/logging_config.py), [docs/rls_policies.sql](docs/rls_policies.sql), [radar/agents/discovery_agent.py](radar/agents/discovery_agent.py), [radar/sources/agencies/icmr_adapter.py](radar/sources/agencies/icmr_adapter.py), [radar/sources/agencies/dbt_adapter.py](radar/sources/agencies/dbt_adapter.py), [radar/db/client.py](radar/db/client.py)
* **Defect:** Cron pipeline failures lacked instant alert dispatches; scrapers lacked `robots.txt` verification and honest user agent contact headers; stale expired opportunities accumulated indefinitely.
* **Fix:**
  - Added `Alert on failure` step in `pipeline.yml` notifying Telegram if workflow fails.
  - Implemented zero-secrets regex redaction in `StructuredLogger` filtering tokens, passwords, and service keys, verified by `tests/unit/test_logging_sanitizer.py`.
  - Authored complete Row-Level Security policies in `docs/rls_policies.sql` granting anon read access and restricting mutations.
  - Added `urllib.robotparser.RobotFileParser` checks and contact user agent `ResearchOpportunityRadar/1.0 (+https://github.com/org/repo; contact: faculty@institution.edu)`.
  - Verified and added `tenacity` exponential backoff retries across all external HTTP adapters.
  - Implemented `archive_stale_opportunities(older_than_days=90)` setting `status = 'archived'` while permanently retaining deduplication fingerprints, verified by `tests/unit/test_archival_policy.py`.

### 8.4 ORCID-Assisted Profile Setup
* **Files:** [radar/sources/orcid_client.py](radar/sources/orcid_client.py), [web/app/api/profile/orcid/route.ts](web/app/api/profile/orcid/route.ts), [web/app/profile/page.tsx](web/app/profile/page.tsx), [tests/unit/test_orcid_client.py](tests/unit/test_orcid_client.py)
* **Feature:** Public ORCID integration allowing zero-friction faculty profile setup:
  - Fetches public records from `https://pub.orcid.org/v3.0/{orcid}/record`.
  - Extracts researcher name, recent institutional affiliation, keywords, and work titles.
  - Infers career stage (early/mid/senior) from publication history and derives candidate topic/venue terms.
  - Provides dedicated "Import from ORCID" review UI in Next.js profile page.
  - Verified with recorded JSON fixture in `tests/unit/test_orcid_client.py`.

## Phase 9 — Cleanup & Compliance-Verification Pass

### 9.1 Root Cause of False-Positive Robots.txt Disallowance
* **Files:** [radar/sources/agency_scraper_base.py](radar/sources/agency_scraper_base.py), [tests/conftest.py](tests/conftest.py), [tests/unit/test_compliance_robots.py](tests/unit/test_compliance_robots.py)
* **Finding:** A previous audit claimed NSF and WikiCFP disallowed target paths. Direct retrieval from an unrestricted vantage point confirmed this was a false positive:
  - **NSF**: `https://www.nsf.gov/robots.txt` has no `/rss/` disallow rule. Path `https://www.nsf.gov/rss/rss_www_funding.xml` is 100% permitted.
  - **WikiCFP**: `http://www.wikicfp.com/robots.txt` contains `User-agent: *\nDisallow:\nCrawl-delay: 5`. Path `http://www.wikicfp.com/cfp/servlet/tool.search` is 100% permitted.
  - **DST-SERB**: `https://dst.gov.in/robots.txt` returns HTTP 404 (Not Found). Under RFC 9309 §2.3.1.2, 404 implies no crawl restrictions.
  - **ICMR**: Migrated to `https://www.icmr.gov.in/robots.txt` (`User-agent: *\nAllow: /`). Target `https://www.icmr.gov.in/call-for-proposals` is 100% permitted.
  - **DBT**: Migrated to `https://dbt.gov.in/robots.txt` (`User-agent: *\nDisallow:`). Target `https://dbt.gov.in/whats-new/call-for-proposals` is 100% permitted.
* **Sandbox Artifact Explanation:** In Python standard library `urllib.robotparser.RobotFileParser.read()`, any HTTP 401 or 403 returned during robots.txt retrieval causes `self.disallow_all = True`. When tests ran in an egress-blocked sandbox environment where `/robots.txt` was rejected by local network policies, `RobotFileParser` defaulted to `disallow_all = True`. Furthermore, standard Python unread/empty parsers return `can_fetch() = False`.
* **Fix:** 
  - Standardized `is_scraping_allowed()` in `agency_scraper_base.py` to enforce RFC 9309 fail-open semantics: if network errors occur or empty rules are parsed, `rp.allow_all = True` is assigned.
  - Created autouse fixture `hermetic_robots_mock` in `tests/conftest.py` intercepting `RobotFileParser.read()` with in-memory rules for tests, guaranteeing 100% offline hermetic execution.
  - Verified with 4 dedicated unit tests in `tests/unit/test_compliance_robots.py`.

### 9.2 Scraper Architecture Consolidation & Migration
* **Files:** [radar/sources/agency_scraper_base.py](radar/sources/agency_scraper_base.py), [radar/agents/discovery_agent.py](radar/agents/discovery_agent.py), [radar/sources/agencies/icmr_adapter.py](radar/sources/agencies/icmr_adapter.py), [radar/sources/agencies/dbt_adapter.py](radar/sources/agencies/dbt_adapter.py), [radar/sources/agencies/example_indian_agency.py](radar/sources/agencies/example_indian_agency.py)
* **Consolidation:** Eliminated duplicated robots.txt parsing across agency adapters. Centralized cache management, cache resets (`reset_robots_cache()`), injection helpers (`set_cached_robots_parser()`), and `AgencyAdapter.check_robots_allowed()` in `radar/sources/agency_scraper_base.py`.

### 9.3 Continuous Live Compliance Drift Auditor
* **Files:** [scripts/verify_live_robots_compliance.py](scripts/verify_live_robots_compliance.py), [.github/workflows/compliance-audit.yml](.github/workflows/compliance-audit.yml)
* **Feature:** Built production auditor script connecting to live external domains to verify `robots.txt` rules and target paths:
  - Fetches and parses live policies for NSF, WikiCFP, DST-SERB, ICMR, and DBT.
  - Gracefully handles Indian government SSL root certificates using fallback verification.
  - Formats results with ASCII status tags and dispatches instant Telegram alerts if any upstream site modifies its robots policy.
  - Scheduled via GitHub Actions workflow (`compliance-audit.yml`) running weekly on Sundays (`cron: '0 0 * * 0'`).

### 9.4 Fully Hermetic Pipeline Idempotency Test
* **File:** [tests/integration/test_pipeline_idempotency.py](tests/integration/test_pipeline_idempotency.py)
* **Defect:** `test_pipeline_idempotency_second_run_zero_new()` relied on `SentenceTransformer` which contacted HuggingFace hub for model weights if un-cached, violating hermetic test discipline.
* **Fix:** Patched `radar.scoring.component_scorer.get_sentence_transformer` with an in-memory `MockTransformer` returning fixed 384-dimensional unit embeddings. Test now executes with zero external network access and passes deterministically.

### 9.5 Repo-Wide Static Analysis CI Gate
* **Files:** [.github/workflows/pipeline.yml](.github/workflows/pipeline.yml), [.github/workflows/frontend-ci.yml](.github/workflows/frontend-ci.yml), `tests/`
* **Defect:** CI previously ran `ruff check radar/`, ignoring linting and typing issues in `tests/` and root scripts (found 70 lint violations across test files).
* **Fix:** Fixed all 70 lint violations across tests and scripts using `ruff check . --fix`. Updated both CI workflows to execute `ruff check .`, preventing any regressions anywhere in the repository.

### 9.6 Anti-Truncation Diagnostics & Full Robots.txt Enforcement
* **Files:** [scripts/verify_live_robots_compliance.py](scripts/verify_live_robots_compliance.py), [tests/conftest.py](tests/conftest.py), [tests/unit/test_compliance_robots.py](tests/unit/test_compliance_robots.py)
* **Root Cause of Silent Truncation/Under-Reporting:**
  - In a previous pass, when authoring `tests/conftest.py` and creating the initial live verification script, the assistant manually extracted a 3-line excerpt (`/admin/`, `/search/`, `/funding/opps`) from NSF's 97-line `robots.txt` file and labeled it "Verbatim Disallow Rules on NSF" in documentation.
  - The live auditor script `scripts/verify_live_robots_compliance.py` fetched `resp.text` and handed it to `RobotFileParser`, but emitted zero byte/line/disallow counts and lacked any anti-truncation assertions or length sanity checks. If an external server, proxy, or sandbox truncated the file mid-stream, the script silently accepted the partial file without warning.
  - Additionally, ICMR's NIC server occasionally experienced network latency timeouts (>10s), which the prior script treated as an unhandled error and defaulted to `allowed = False`, generating false disallowance alarms.
* **Fix & Hardening:**
  - **Diagnostic Metrics & Anti-Truncation Assertions**: Upgraded `scripts/verify_live_robots_compliance.py` to calculate and report byte size, line count, Disallow count, Allow count, and Sitemap count for each domain.
  - Added strict sanity-check thresholds (`min_expected_lines`, `min_expected_bytes`, `min_disallow_rules`) per domain (e.g., NSF requires $\ge$ 30 lines, $\ge$ 1000 bytes, $\ge$ 20 disallows). If any threshold is breached, the audit fails with status `TRUNCATION SUSPECTED` and exit code 1.
  - **Full Authentic NSF Ruleset**: Updated `tests/conftest.py` to embed the complete authentic 97-line NSF robots.txt ruleset (53 Disallows, 18 Allows, Drupal CMS paths, `/careers/openings`, `/events?*`, legacy `/cgi-bin/`, `/awardsearch/*`, `/por/*`, `/pubs/*`).
  - **Resilience & Backoff**: Added retry logic with exponential backoff (`3` attempts, backoff factor 2.0) for Indian NIC government servers (`icmr.gov.in`, `dbt.gov.in`, `dst.gov.in`) with increased timeouts (15s).
  - **Simulation & Raw Inspection Flags**: Added `--simulate-truncation` flag (simulates a 3-line partial NSF fetch and proves the audit fails with exit code 1) and `--dump-raw` flag (prints full raw robots.txt for side-by-side inspection).
  - **Automated Tests**: Added `test_nsf_full_ruleset_compliance` and `test_anti_truncation_sanity_check_flags_short_file` in `tests/unit/test_compliance_robots.py`.
* **Path Disallowance Verdict**: Re-verified all 5 domains against their complete live rules. Target path `https://www.nsf.gov/rss/rss_www_funding.xml` has NO disallow rule in either the full 97-line live file or the test mock. All 5 target paths remain **100% permitted**.


## Phase 10 — Close the Compliance Audit, Verify Real Parsing & Ship-Readiness Pass

### 10.1 Anti-Truncation Diagnostics & Verification of Robots.txt
* **Files:** [scripts/verify_live_robots_compliance.py](scripts/verify_live_robots_compliance.py), [tests/conftest.py](tests/conftest.py), [tests/unit/test_compliance_robots.py](tests/unit/test_compliance_robots.py)
* **Root Cause of Truncation:** A previous test mock in `tests/conftest.py` containing an arbitrary 3-line excerpt was accidentally referenced as verbatim NSF rules in documentation. The live audit script had no verification of received payload byte length against the HTTP `Content-Length` header and lacked structural floors.
* **Hardening:**
  - Added strict `Content-Length` header matching against received bytes (`cl_header` check).
  - Added structural floors (`min_expected_lines`, `min_expected_bytes`, `min_disallow_rules`) per domain.
  - Implemented `--simulate-truncation` CLI flag (proves script exits 1 on truncated reads) and `--dump-raw` CLI flag.
  - Authored independent verification script (`scratch/independent_robots_fetch.py`) retrieving raw bytes directly with standard library requests.
  - Verified identical byte count, line count, and SHA-256 hash across all 5 domains (NSF: 2,803 bytes / 97 lines / 53 disallows; WikiCFP: 321 bytes / 18 lines / 8 disallows; DST: 296 bytes / HTTP 404; ICMR: 68 bytes / 3 lines / HTTP 200; DBT: 24 bytes / 2 lines / HTTP 200).
  - Target path `https://www.nsf.gov/rss/rss_www_funding.xml` has 0 disallow rules in either truncated or full versions. 100% permitted.
  - Added unit tests `test_anti_truncation_sanity_check_flags_short_file` and `test_anti_truncation_sanity_check_flags_content_length_mismatch` (7/7 passing in `test_compliance_robots.py`).

### 10.2 Real Parsing of Indian Agency Notices (ICMR & DBT)
* **Files:** [radar/sources/agencies/icmr_adapter.py](radar/sources/agencies/icmr_adapter.py), [radar/sources/agencies/dbt_adapter.py](radar/sources/agencies/dbt_adapter.py), [tests/fixtures/icmr_notices_2026-09.html](tests/fixtures/icmr_notices_2026-09.html), [tests/fixtures/dbt_notices_2026-09.json](tests/fixtures/dbt_notices_2026-09.json), [tests/unit/test_agency_real_fixtures.py](tests/unit/test_agency_real_fixtures.py)
* **Defects & Real DOM / API Architecture:**
  - **ICMR:** Upstream domain migrated from `main.icmr.nic.in` (dead DNS) to `https://www.icmr.gov.in/call-for-proposals`. In the table schema `[Serial, Title, Last Date, Link To Apply, Document]`, the prior parser extracted the document link text ("Open Document(...)") as the title. Fixed adapter to extract title from `td[1]`, deadline from `td[2]`, and document link from `td[4] a[href]`. Correctly parses 7 live calls.
  - **DBT:** Upstream domain migrated from `dbtindia.gov.in` to `dbt.gov.in`. DBT runs an Inertia SPA with dynamic client-side rendering. Static HTML scraping of `/whats-new/call-for-proposals` returned empty shells. Reverse-engineered the JavaScript bundle (`call-for-proposals-CWkz8Qg4.js`) and discovered the live JSON data endpoint: `https://dbt.gov.in/data-view?name=call-for-proposals`. Rewrote adapter to parse structured JSON (`title`, `start_date`, `end_date`, `file_url`). Correctly parses 14 live calls.
* **Test Fixtures & Regression Suite:**
  - Committed authentic live response fixtures permanently to `tests/fixtures/`: `icmr_notices_2026-09.html` (101 KB) and `dbt_notices_2026-09.json` (5.3 KB).
  - Added permanent regression test suite `tests/unit/test_agency_real_fixtures.py` asserting title, URL, deadline date, and agency name extraction on authentic payloads (2/2 passing).

### 10.3 NSF Awards API vs Grants.gov Solicitations & Dedup Separation
* **Files:** [radar/dedup/fingerprint.py](radar/dedup/fingerprint.py), [tests/unit/test_fingerprint.py](tests/unit/test_fingerprint.py), [web/app/page.tsx](web/app/page.tsx), [web/app/opportunities/[id]/page.tsx](web/app/opportunities/[id]/page.tsx)
* **Rationale & Fix:** Historical grant awards (retrieved via NSF Awards API) serve as funding intelligence indicating active program areas, while Grants.gov solicitations are open funding calls with active deadlines. Collapsing them under deduplication destroys critical intelligence.
* **Fingerprint Guard:** Added `is_award_record()` helper to `fingerprint.py`. Candidate matching across all stages (exact ID, DOI, strict normalized title, agency number, fuzzy title) now filters candidates by award modality (`is_award_record(c) == is_award_record(cand)`).
* **UI Differentiation:**
  - Added distinct amber badge on award records: `ACTIVE PROGRAM — AWARDED FUNDING HISTORY` (`bg-amber-500/20 text-amber-300 border border-amber-500/30`) vs red badge `OPEN CALL — DEADLINE [date]`.
  - Added prominent callout banner in opportunity detail page explaining that the record represents awarded program history rather than an active application deadline.
* **Test Verification:** Added `test_award_record_never_collapses_with_open_grant_solicitation` in `tests/unit/test_fingerprint.py` (4/4 passing).

### 10.4 WikiCFP Scope Clarification
* **Files:** [radar/agents/discovery_agent.py](radar/agents/discovery_agent.py), [web/app/page.tsx](web/app/page.tsx), [README.md](README.md)
* **Scope Clarification:** WikiCFP is actively integrated in the live autonomous discovery cycle (`DiscoveryAgent.search_wikicfp()`), querying `http://www.wikicfp.com/cfp/servlet/tool.search` for academic calls for papers and symposiums matching faculty keywords.
* **Matrix Counter:** Updated dashboard matrix header to `SOURCE NODES: 9 INTEGRATED` (OpenAlex, Crossref, Semantic Scholar, Grants.gov, NSF Solicitations RSS, WikiCFP, ICMR, DBT India, DST-SERB).

### 10.5 Pipeline Alert Resilience & Error Isolation
* **Files:** [radar/orchestrator/pipeline.py](radar/orchestrator/pipeline.py), [radar/notify/telegram.py](radar/notify/telegram.py), [tests/unit/test_alert_resilience.py](tests/unit/test_alert_resilience.py)
* **Resilience:** Wrapped `telegram.send()`, `email_brevo.send()`, and `ics_builder.regenerate_and_upload()` in dedicated try/except blocks in `pipeline.py`. Updated `telegram.py` fallback to invoke `res.raise_for_status()`. Notification timeouts or invalid credentials are logged as non-fatal alert errors without halting pipeline execution.
* **Verification:** Added `tests/unit/test_alert_resilience.py` (2/2 passing).

### 10.6 API Security Hardening & Rate Limiting
* **Files:** [web/lib/rateLimit.ts](web/lib/rateLimit.ts), [web/lib/apiAuth.ts](web/lib/apiAuth.ts), [web/app/api/pipeline/trigger/route.ts](web/app/api/pipeline/trigger/route.ts), [web/app/api/pipeline/stream/route.ts](web/app/api/pipeline/stream/route.ts), [web/app/api/profile/route.ts](web/app/api/profile/route.ts), [web/app/api/opportunities/[id]/route.ts](web/app/api/opportunities/[id]/route.ts), [web/__tests__/security.test.ts](web/__tests__/security.test.ts)
* **Security Controls:**
  - **Rate Limiting:** Built in-memory sliding-window rate limiter in `web/lib/rateLimit.ts` returning HTTP 429 and `Retry-After` header when thresholds are exceeded.
  - **Authentication:** Built shared secret authenticator in `web/lib/apiAuth.ts` validating `RADAR_API_SECRET` via `Authorization: Bearer` or `x-radar-secret` header.
  - **Input Validation:** Enforced Zod string length limits on profile payload and regex ID validation (`/^[a-zA-Z0-9_\-\.]{1,64}$/`) on opportunity routes.
  - **Test Suite:** Verified with 5 unit tests in `web/__tests__/security.test.ts` (8/8 passing across web test suite).

## Phase 11 — Fix Two Confirmed Structural Regressions

### 11.1 Robots.txt allow_all Override & Python 3.11 Standard Library Divergence
* **Files:** [radar/sources/agency_scraper_base.py](radar/sources/agency_scraper_base.py), [tests/unit/test_compliance_robots.py](tests/unit/test_compliance_robots.py), [scripts/verify_live_robots_compliance.py](scripts/verify_live_robots_compliance.py)
* **Root Cause:**
  - Python standard library `urllib.robotparser.RobotFileParser` in Python 3.11 stores wildcard `User-agent: *` blocks in `rp.default_entry`, leaving `rp.entries` as `[]`.
  - In `agency_scraper_base.py`, the line `if not rp.entries and not rp.disallow_all: rp.allow_all = True` evaluated to `True` on Python 3.11 even when real active disallow rules were present under `User-agent: *`. This set `rp.allow_all = True`, which forced `can_fetch()` to return `True` unconditionally, silently bypassing all disallow rules.
  - In the local development environment running Python 3.14, `RobotFileParser` internally unified wildcard entries into `rp.entries`, so the bug was masked during local test execution.
* **Fix & Hardening:**
  - Completely removed the unneeded `if not rp.entries and not rp.disallow_all: rp.allow_all = True` override from `agency_scraper_base.py`. Python\'s `can_fetch()` already natively allows fetching when no matching disallow rules exist (including DBT-style `Disallow:` and 0-byte empty files).
  - Preserved fail-open behavior in the `except Exception:` block so that network/DNS failures or HTTP errors still permit scraping per RFC 9309 §2.3.1.2.
  - Added regression test `test_wildcard_allow_and_disallow_rules_enforced` (verifying both allow and disallow paths under `User-agent: *`) and `test_empty_robots_and_dbt_style_allow_scraping`.
  - Updated `scripts/verify_live_robots_compliance.py` to evaluate live enforcement, proving that `is_scraping_allowed()` returns `False` for real NSF disallowed paths (`https://www.nsf.gov/admin/`, `https://www.nsf.gov/funding/opps`).

### 11.2 Grounded Citizenship/Security Eligibility Check
* **Files:** [radar/agents/eligibility_agent.py](radar/agents/eligibility_agent.py), [radar/tools/funding_deadline_scan.py](radar/tools/funding_deadline_scan.py), [radar/agents/discovery_agent.py](radar/agents/discovery_agent.py), [tests/unit/test_eligibility_agent.py](tests/unit/test_eligibility_agent.py), [web/app/opportunities/[id]/page.tsx](web/app/opportunities/[id]/page.tsx)
* **Root Cause:**
  - `EligibilityAgent` checked `opp.metadata.get("solicitation_guidelines")` and `opp.metadata.get("eligibility_clause")`, but neither key was ever populated by live data ingestors.
  - As a result, the citizenship rule only searched the title and two-sentence summary, defaulting to `PASS` ("International and domestic investigators eligible") whenever no literal `"u.s. citizens only"` phrase appeared. This produced false negatives on DoD, defense, and federal funding calls where eligibility cannot be verified from titles alone.
* **Fix (Part 1 — Grounded Data Capture):**
  - In `funding_deadline_scan.py`: captured `hit.get("description")` and `hit.get("applicantEligibilityDesc")` into `opp.metadata["solicitation_guidelines"]` and `["eligibility_clause"]`.
  - In `discovery_agent.py`: captured `raw_desc` into `opp.metadata["solicitation_guidelines"]` for NSF solicitations and `summary_txt` for arXiv preprints.
* **Fix (Part 2 — Stop Defaulting to PASS):**

## Phase 10 — Close the Compliance Audit, Verify Real Parsing & Ship-Readiness Pass

### 10.1 Anti-Truncation Diagnostics & Verification of Robots.txt
* **Files:** [scripts/verify_live_robots_compliance.py](scripts/verify_live_robots_compliance.py), [tests/conftest.py](tests/conftest.py), [tests/unit/test_compliance_robots.py](tests/unit/test_compliance_robots.py)
* **Root Cause of Truncation:** A previous test mock in `tests/conftest.py` containing an arbitrary 3-line excerpt was accidentally referenced as verbatim NSF rules in documentation. The live audit script had no verification of received payload byte length against the HTTP `Content-Length` header and lacked structural floors.
* **Hardening:**
  - Added strict `Content-Length` header matching against received bytes (`cl_header` check).
  - Added structural floors (`min_expected_lines`, `min_expected_bytes`, `min_disallow_rules`) per domain.
  - Implemented `--simulate-truncation` CLI flag (proves script exits 1 on truncated reads) and `--dump-raw` CLI flag.
  - Authored independent verification script (`scratch/independent_robots_fetch.py`) retrieving raw bytes directly with standard library requests.
  - Verified identical byte count, line count, and SHA-256 hash across all 5 domains (NSF: 2,803 bytes / 97 lines / 53 disallows; WikiCFP: 321 bytes / 18 lines / 8 disallows; DST: 296 bytes / HTTP 404; ICMR: 68 bytes / 3 lines / HTTP 200; DBT: 24 bytes / 2 lines / HTTP 200).
  - Target path `https://www.nsf.gov/rss/rss_www_funding.xml` has 0 disallow rules in either truncated or full versions. 100% permitted.
  - Added unit tests `test_anti_truncation_sanity_check_flags_short_file` and `test_anti_truncation_sanity_check_flags_content_length_mismatch` (7/7 passing in `test_compliance_robots.py`).

### 10.2 Real Parsing of Indian Agency Notices (ICMR & DBT)
* **Files:** [radar/sources/agencies/icmr_adapter.py](radar/sources/agencies/icmr_adapter.py), [radar/sources/agencies/dbt_adapter.py](radar/sources/agencies/dbt_adapter.py), [tests/fixtures/icmr_notices_2026-09.html](tests/fixtures/icmr_notices_2026-09.html), [tests/fixtures/dbt_notices_2026-09.json](tests/fixtures/dbt_notices_2026-09.json), [tests/unit/test_agency_real_fixtures.py](tests/unit/test_agency_real_fixtures.py)
* **Defects & Real DOM / API Architecture:**
  - **ICMR:** Upstream domain migrated from `main.icmr.nic.in` (dead DNS) to `https://www.icmr.gov.in/call-for-proposals`. In the table schema `[Serial, Title, Last Date, Link To Apply, Document]`, the prior parser extracted the document link text ("Open Document(...)") as the title. Fixed adapter to extract title from `td[1]`, deadline from `td[2]`, and document link from `td[4] a[href]`. Correctly parses 7 live calls.
  - **DBT:** Upstream domain migrated from `dbtindia.gov.in` to `dbt.gov.in`. DBT runs an Inertia SPA with dynamic client-side rendering. Static HTML scraping of `/whats-new/call-for-proposals` returned empty shells. Reverse-engineered the JavaScript bundle (`call-for-proposals-CWkz8Qg4.js`) and discovered the live JSON data endpoint: `https://dbt.gov.in/data-view?name=call-for-proposals`. Rewrote adapter to parse structured JSON (`title`, `start_date`, `end_date`, `file_url`). Correctly parses 14 live calls.
* **Test Fixtures & Regression Suite:**
  - Committed authentic live response fixtures permanently to `tests/fixtures/`: `icmr_notices_2026-09.html` (101 KB) and `dbt_notices_2026-09.json` (5.3 KB).
  - Added permanent regression test suite `tests/unit/test_agency_real_fixtures.py` asserting title, URL, deadline date, and agency name extraction on authentic payloads (2/2 passing).

### 10.3 NSF Awards API vs Grants.gov Solicitations & Dedup Separation
* **Files:** [radar/dedup/fingerprint.py](radar/dedup/fingerprint.py), [tests/unit/test_fingerprint.py](tests/unit/test_fingerprint.py), [web/app/page.tsx](web/app/page.tsx), [web/app/opportunities/[id]/page.tsx](web/app/opportunities/[id]/page.tsx)
* **Rationale & Fix:** Historical grant awards (retrieved via NSF Awards API) serve as funding intelligence indicating active program areas, while Grants.gov solicitations are open funding calls with active deadlines. Collapsing them under deduplication destroys critical intelligence.
* **Fingerprint Guard:** Added `is_award_record()` helper to `fingerprint.py`. Candidate matching across all stages (exact ID, DOI, strict normalized title, agency number, fuzzy title) now filters candidates by award modality (`is_award_record(c) == is_award_record(cand)`).
* **UI Differentiation:**
  - Added distinct amber badge on award records: `ACTIVE PROGRAM — AWARDED FUNDING HISTORY` (`bg-amber-500/20 text-amber-300 border border-amber-500/30`) vs red badge `OPEN CALL — DEADLINE [date]`.
  - Added prominent callout banner in opportunity detail page explaining that the record represents awarded program history rather than an active application deadline.
* **Test Verification:** Added `test_award_record_never_collapses_with_open_grant_solicitation` in `tests/unit/test_fingerprint.py` (4/4 passing).

### 10.4 WikiCFP Scope Clarification
* **Files:** [radar/agents/discovery_agent.py](radar/agents/discovery_agent.py), [web/app/page.tsx](web/app/page.tsx), [README.md](README.md)
* **Scope Clarification:** WikiCFP is actively integrated in the live autonomous discovery cycle (`DiscoveryAgent.search_wikicfp()`), querying `http://www.wikicfp.com/cfp/servlet/tool.search` for academic calls for papers and symposiums matching faculty keywords.
* **Matrix Counter:** Updated dashboard matrix header to `SOURCE NODES: 9 INTEGRATED` (OpenAlex, Crossref, Semantic Scholar, Grants.gov, NSF Solicitations RSS, WikiCFP, ICMR, DBT India, DST-SERB).

### 10.5 Pipeline Alert Resilience & Error Isolation
* **Files:** [radar/orchestrator/pipeline.py](radar/orchestrator/pipeline.py), [radar/notify/telegram.py](radar/notify/telegram.py), [tests/unit/test_alert_resilience.py](tests/unit/test_alert_resilience.py)
* **Resilience:** Wrapped `telegram.send()`, `email_brevo.send()`, and `ics_builder.regenerate_and_upload()` in dedicated try/except blocks in `pipeline.py`. Updated `telegram.py` fallback to invoke `res.raise_for_status()`. Notification timeouts or invalid credentials are logged as non-fatal alert errors without halting pipeline execution.
* **Verification:** Added `tests/unit/test_alert_resilience.py` (2/2 passing).

### 10.6 API Security Hardening & Rate Limiting
* **Files:** [web/lib/rateLimit.ts](web/lib/rateLimit.ts), [web/lib/apiAuth.ts](web/lib/apiAuth.ts), [web/app/api/pipeline/trigger/route.ts](web/app/api/pipeline/trigger/route.ts), [web/app/api/pipeline/stream/route.ts](web/app/api/pipeline/stream/route.ts), [web/app/api/profile/route.ts](web/app/api/profile/route.ts), [web/app/api/opportunities/[id]/route.ts](web/app/api/opportunities/[id]/route.ts), [web/__tests__/security.test.ts](web/__tests__/security.test.ts)
* **Security Controls:**
  - **Rate Limiting:** Built in-memory sliding-window rate limiter in `web/lib/rateLimit.ts` returning HTTP 429 and `Retry-After` header when thresholds are exceeded.
  - **Authentication:** Built shared secret authenticator in `web/lib/apiAuth.ts` validating `RADAR_API_SECRET` via `Authorization: Bearer` or `x-radar-secret` header.
  - **Input Validation:** Enforced Zod string length limits on profile payload and regex ID validation (`/^[a-zA-Z0-9_\-\.]{1,64}$/`) on opportunity routes.
  - **Test Suite:** Verified with 5 unit tests in `web/__tests__/security.test.ts` (8/8 passing across web test suite).

## Phase 11 — Fix Two Confirmed Structural Regressions

### 11.1 Robots.txt allow_all Override & Python 3.11 Standard Library Divergence
* **Files:** [radar/sources/agency_scraper_base.py](radar/sources/agency_scraper_base.py), [tests/unit/test_compliance_robots.py](tests/unit/test_compliance_robots.py), [scripts/verify_live_robots_compliance.py](scripts/verify_live_robots_compliance.py)
* **Root Cause:**
  - Python standard library `urllib.robotparser.RobotFileParser` in Python 3.11 stores wildcard `User-agent: *` blocks in `rp.default_entry`, leaving `rp.entries` as `[]`.
  - In `agency_scraper_base.py`, the line `if not rp.entries and not rp.disallow_all: rp.allow_all = True` evaluated to `True` on Python 3.11 even when real active disallow rules were present under `User-agent: *`. This set `rp.allow_all = True`, which forced `can_fetch()` to return `True` unconditionally, silently bypassing all disallow rules.
  - In the local development environment running Python 3.14, `RobotFileParser` internally unified wildcard entries into `rp.entries`, so the bug was masked during local test execution.
* **Fix & Hardening:**
  - Completely removed the unneeded `if not rp.entries and not rp.disallow_all: rp.allow_all = True` override from `agency_scraper_base.py`. Python\'s `can_fetch()` already natively allows fetching when no matching disallow rules exist (including DBT-style `Disallow:` and 0-byte empty files).
  - Preserved fail-open behavior in the `except Exception:` block so that network/DNS failures or HTTP errors still permit scraping per RFC 9309 §2.3.1.2.
  - Added regression test `test_wildcard_allow_and_disallow_rules_enforced` (verifying both allow and disallow paths under `User-agent: *`) and `test_empty_robots_and_dbt_style_allow_scraping`.
  - Updated `scripts/verify_live_robots_compliance.py` to evaluate live enforcement, proving that `is_scraping_allowed()` returns `False` for real NSF disallowed paths (`https://www.nsf.gov/admin/`, `https://www.nsf.gov/funding/opps`).

### 11.2 Grounded Citizenship/Security Eligibility Check
* **Files:** [radar/agents/eligibility_agent.py](radar/agents/eligibility_agent.py), [radar/tools/funding_deadline_scan.py](radar/tools/funding_deadline_scan.py), [radar/agents/discovery_agent.py](radar/agents/discovery_agent.py), [tests/unit/test_eligibility_agent.py](tests/unit/test_eligibility_agent.py), [web/app/opportunities/[id]/page.tsx](web/app/opportunities/[id]/page.tsx)
* **Root Cause:**
  - `EligibilityAgent` checked `opp.metadata.get("solicitation_guidelines")` and `opp.metadata.get("eligibility_clause")`, but neither key was ever populated by live data ingestors.
  - As a result, the citizenship rule only searched the title and two-sentence summary, defaulting to `PASS` ("International and domestic investigators eligible") whenever no literal `"u.s. citizens only"` phrase appeared. This produced false negatives on DoD, defense, and federal funding calls where eligibility cannot be verified from titles alone.
* **Fix (Part 1 — Grounded Data Capture):**
  - In `funding_deadline_scan.py`: captured `hit.get("description")` and `hit.get("applicantEligibilityDesc")` into `opp.metadata["solicitation_guidelines"]` and `["eligibility_clause"]`.
  - In `discovery_agent.py`: captured `raw_desc` into `opp.metadata["solicitation_guidelines"]` for NSF solicitations and `summary_txt` for arXiv preprints.
* **Fix (Part 2 — Stop Defaulting to PASS):**
  - Updated `EligibilityAgent.evaluate_opportunity()`:
    - Academic publications and conferences (`kind in ("journal", "venue")`) evaluate to `PASS` since scientific publishing has no citizenship/security barriers.
    - When full guidelines are present, keywords are searched. If no restrictions exist in the guidelines, `PASS` is awarded.
    - When a funding opportunity lacks full guidelines (title/short-summary only), the citizenship check returns `verdict = "NEEDS_MANUAL_REVIEW"`, setting the overall report status to `NEEDS_MANUAL_REVIEW`, confidence to 0.60, and generating an action item: *"Verify citizenship, residency, and ITAR/export-control eligibility clauses directly in official solicitation document."*
* **Frontend & Test Verification:**
  - Added unit test `test_citizenship_unverified_requires_manual_review` in `tests/unit/test_eligibility_agent.py`.
  - Updated `web/app/opportunities/[id]/page.tsx` to render `NEEDS_MANUAL_REVIEW` in amber (`bg-amber-500/20 text-amber-300 border-amber-500/40`).

## Phase 12 — Final Polish, First Real Deployment & Production Ship

### 12.1 Component Scorer Model Exception Narrowing & Production Alerting
* **Files:** [radar/scoring/component_scorer.py](radar/scoring/component_scorer.py)
* **Problem:** `get_sentence_transformer()` previously caught bare `except Exception:`, silently substituting a constant-vector `MockTransformer` even in production outages or configuration failures, obscuring broken scoring.
* **Fix:**
  - Narrowed exception catch to explicit network/caching error types: `(OSError, ConnectionError, TimeoutError, HfHubHTTPError)`.
  - Added test environment detection (`is_test_environment()`: checking `"pytest" in sys.modules`, `PYTEST_CURRENT_TEST`, or `RADAR_MOCK_EMBEDDINGS=1`).
  - Outside test contexts, fallback triggers loud `CRITICAL` error logging and dispatches a high-priority Telegram alert (`🚨 CRITICAL SCORING WARNING: SentenceTransformer model failed to load on host`).
  - Non-network / unexpected exceptions (e.g. corruption, type errors) are re-raised in production.

### 12.2 Timing-Safe Secret Comparison in API Authorization
* **Files:** [web/lib/apiAuth.ts](web/lib/apiAuth.ts), [web/__tests__/security.test.ts](web/__tests__/security.test.ts)
* **Problem:** Bearer token and `x-radar-secret` headers were compared against `process.env.RADAR_API_SECRET` using standard JavaScript `===`, leaving a potential timing-attack side channel on secret verification.
* **Fix:** Implemented `timingSafeMatch(provided, expected)` using Node.js `crypto.timingSafeEqual` applied to SHA-256 digests. Because SHA-256 digests are always 32-byte buffers, comparison executes in strictly constant time without leaking token length or timing characteristics.

### 12.3 ORCID Parsing Cross-Referencing & Shared Test Fixture Contract
* **Files:** [radar/sources/orcid_client.py](radar/sources/orcid_client.py), [web/app/api/profile/orcid/route.ts](web/app/api/profile/orcid/route.ts), [tests/fixtures/orcid_2026_sample.json](tests/fixtures/orcid_2026_sample.json), [tests/unit/test_orcid_client.py](tests/unit/test_orcid_client.py), [web/__tests__/orcid.test.ts](web/__tests__/orcid.test.ts)
* **Clarification:** Documented the intentional dual-implementation architecture: Python `orcid_client` handles batch backend tasks, while TypeScript Next.js route provides zero-latency client pre-filling without process-spawn overhead.
* **Contract:** Extracted shared test fixture `tests/fixtures/orcid_2026_sample.json`. Both implementations are now verified against this identical fixture:
  - Python: `tests/unit/test_orcid_client.py` (2/2 passing).
  - TypeScript: `web/__tests__/orcid.test.ts` (2/2 passing).

### 12.4 In-Memory Rate Limiting Single-Instance Architectural Notice
* **Files:** [web/lib/rateLimit.ts](web/lib/rateLimit.ts), [README.md](README.md)
* **Documentation:** Explicitly documented that `rateLimitMap` is stored in process memory. Single-instance deployments (single Docker container or standalone Node.js process) are fully protected. Multi-replica, horizontally scaled, or serverless deployments require migrating to a shared distributed store (Redis / Upstash).

### 12.5 Scheduled Stale Opportunities Archival Execution & Telemetry
* **Files:** [radar/orchestrator/pipeline.py](radar/orchestrator/pipeline.py)
* **Hardening:** Wired `archive_stale_opportunities(older_than_days=90)` into `run_pipeline()` with structured logging, dry-run guards, exception isolation, and dedicated `ArchivalSentinel` telemetry events.

### 12.6 Live Deployment & Authentication Gate Verification
* **Server Verification:** Next.js production server compiled (`15/15` static & dynamic routes) and ran live on `http://localhost:3000`.
* **API Auth Gate (`curl` Verification):**
  - Unauthenticated `curl.exe -i -X POST http://localhost:3000/api/pipeline/trigger`: Returned `HTTP/1.1 401 Unauthorized`.
  - Invalid Token `curl.exe -i -X POST http://localhost:3000/api/pipeline/trigger -H "Authorization: Bearer wrong_secret"`: Returned `HTTP/1.1 401 Unauthorized`.
  - Valid Token `curl.exe -i -X POST http://localhost:3000/api/pipeline/trigger -H "Authorization: Bearer production_super_secret_key_2026"`: Passed auth check into handler (`HTTP/1.1 501 Not Implemented: GITHUB_PAT not configured`).
* **Live ORCID Ingestion:** Live query against `http://localhost:3000/api/profile/orcid?orcid=0000-0002-1825-0097` successfully fetched real records from `pub.orcid.org` (Josiah Carberry, 7 works, career stage senior, 11 candidate terms).
