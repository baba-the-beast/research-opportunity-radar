# Research Opportunity Radar — Deployment & Hosting Checklist

This document is the definitive reference for configuring hosting environments (Render, Fly.io, Railway, VPS, or Docker container runners).

---

## 1. Required & Optional Environment Variables

Configure these environment variables in your hosting provider's dashboard or container secret settings:

| Variable Name | Required? | Source / Description |
|---|---|---|
| `SUPABASE_URL` | **YES** | Supabase Project REST URL (`https://<project-ref>.supabase.co`) from Supabase Console -> Settings -> API. |
| `SUPABASE_SERVICE_ROLE_KEY` | **YES** | Supabase secret service role key (bypasses RLS for backend writes) from Supabase Console -> Settings -> API. |
| `SUPABASE_ANON_KEY` | **YES** | Supabase anon (public) key. Route handlers use it with the caller's JWT so Row Level Security applies. |
| `NEXT_PUBLIC_SUPABASE_URL` | **YES (build + runtime)** | Same value as `SUPABASE_URL`. Inlined into the browser bundle at **build** time, so it must also be available to the Docker build (declared as a build `ARG`). Without it production returns 503 and login cannot work. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **YES (build + runtime)** | Same value as `SUPABASE_ANON_KEY`; browser auth. Build-time, like the URL above. Public by design. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Recommended | Shared rate limiting across instances and restarts. Without them limits are per process. |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | Optional | AI Copilot providers (offline heuristic engine otherwise). Model ids via `GEMINI_MODEL` / `OPENAI_MODEL`. |
| `ALLOW_IN_MEMORY_DB` | **YES** | Set to `0` in production so opportunities and run logs persist directly to Supabase. |
| `OPENALEX_API_KEY` | **YES** | OpenAlex API Key or polite-pool institutional email address from https://openalex.org. |
| `CROSSREF_MAILTO` | Recommended | Contact email for polite-pool Crossref metadata extraction. |
| `TELEGRAM_BOT_TOKEN` | Optional | Telegram Bot API token from @BotFather for immediate opportunity alerts. |
| `TELEGRAM_BOT_USERNAME` | For Telegram | Bot username without `@` (web server). Printed by `python scripts/telegram_setup.py --check`. |
| `TELEGRAM_WEBHOOK_SECRET` | For Telegram | Random 16-256 chars (`A-Z a-z 0-9 _ -`), web server. Authenticates Telegram's webhook calls. |
| `TELEGRAM_CHAT_ID` | Optional | Telegram chat or channel ID receiving high-resonance alerts. |
| `SEMANTIC_SCHOLAR_API_KEY` | Optional | Graph API key from https://www.semanticscholar.org/product/api (bypasses unauthenticated rate limits). |
| `BREVO_API_KEY` | Optional | Brevo (Sendinblue) API key for automated weekly executive email digests. |
| `BREVO_SENDER_EMAIL` | Optional | Verified sender email configured in Brevo dashboard. |
| `BREVO_RECIPIENT_EMAIL` | Optional | Faculty recipient email address for weekly opportunity digests. |
| `MIN_RELEVANCE_BAND` | Recommended | Minimum scoring band triggering alerts (`immediate`, `digest`, or `watch`; default: `watch`). |
| `DEADLINE_ALERT_WINDOW_DAYS` | Recommended | Rolling window in days for urgent deadline detection (default: `30`). |
| `GITHUB_PAT` | Optional | GitHub Personal Access Token with repo/workflow dispatch scopes for triggering actions. |
| `GITHUB_REPO` | Optional | Target GitHub repository (`baba-the-beast/research-opportunity-radar`). |
| `RADAR_API_SECRET` | **YES** | Cryptographically random secret (32+ chars) protecting external webhook triggers (`/api/pipeline/trigger`) with constant-time verification. Never prefix with `NEXT_PUBLIC_`. |
| `PROJECT_ROOT` | **YES** | Path to application root (`/app` in Docker; host directory if running natively). |

---

## 2. Docker Build & Container Specifications

- Container Structure (`Dockerfile`): Multi-stage image on `python:3.11-slim` with Node.js 20 LTS installed.
- Pre-cached ML Weights: Downloads and caches `sentence-transformers/all-MiniLM-L6-v2` during image build.
- Port: Exposes port `3000` (Next.js Observatory console + background orchestrator).
- Resource Sizing:
  - Minimum RAM: 1.0 GB
  - Recommended RAM: 2.0 GB (e.g. Render Standard, Railway, Fly.io 2GB VM, AWS ECS Fargate)
- Local Host Status: Docker CLI is not installed on this local Windows machine. On target cloud/VPS runner, build and execute with:
  ```bash
  docker build -t research-opportunity-radar .
  docker run -p 3000:3000 --env-file .env research-opportunity-radar
  ```

---

## 3. Production Supabase Project Status

- Connectivity: Verified live ping `HTTP 200 OK` using project credentials.
- Database Tables Verified:
  - `opportunities` (Confirmed present, 0 rows)
  - `faculty_profile` (Confirmed present, 0 rows)
  - `profile_terms` (Confirmed present, 0 rows)
  - `run_log` (Confirmed present, 0 rows)
  - `source_runs` (Confirmed present, 0 rows)
  - `opportunity_deadlines` (Confirmed present, 0 rows)
- Row Level Security (RLS): Policies applied via the migrations in `supabase/migrations/` (apply in filename order).
- Faculty Profile State: No profile currently exists in `faculty_profile`. A real faculty profile must be inserted before running scheduled autonomous pipeline cycles.

---

## 4. Outstanding Items Before Cloud Go-Live

- Database: apply `supabase/migrations/` (see README → Database Migrations; run `supabase migration repair` for files already applied by hand).
- Web auth configuration: set `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Production refuses anonymous requests when these are missing.
- Roles: operator/admin roles must be set in Supabase `app_metadata` (server-controlled). `user_metadata.role` is ignored because users can edit it.
- Rate limiting: set `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` so limits survive restarts and are shared across instances.
- Alerts: add `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_RECIPIENT_EMAIL` as GitHub Actions secrets for per-user email digests from the scheduled pipeline.

1. Faculty Profile: Enter a real faculty profile (name, institution, research keywords) either in Supabase Table Editor or via the `/profile` page once deployed.
2. Optional Credentials: If email digests or elevated Semantic Scholar throughput are desired, configure `BREVO_API_KEY` and `SEMANTIC_SCHOLAR_API_KEY` as needed.
3. Secret Hygiene & Configuration: Set `RADAR_API_SECRET` in your hosting provider's environment settings. Ensure `NEXT_PUBLIC_RADAR_API_SECRET` is DELETED if previously set (env vars prefixed `NEXT_PUBLIC_` are baked into client JavaScript bundles and leaked to browser visitors). Browser dashboard routes (`/api/pipeline/stream`, `/api/profile`, `/api/opportunities/[id]/status`) rely on per-IP rate limiting and strict Zod validation without embedding secrets in client bundles.

