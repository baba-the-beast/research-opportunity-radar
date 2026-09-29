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
| `CROSSREF_MAILTO` | Recommended | Your email; polite-pool access to OpenAlex/Crossref (MCP literature tool). No key is needed for the agency sources or WikiCFP. |
| `OPENALEX_API_KEY` | Optional | OpenAlex key or email; falls back to `CROSSREF_MAILTO`. |
| `TELEGRAM_BOT_TOKEN` | Optional | Telegram Bot API token from @BotFather for immediate opportunity alerts. |
| `TELEGRAM_BOT_USERNAME` | For Telegram | Bot username without `@` (web server). Printed by `python scripts/telegram_setup.py --check`. |
| `TELEGRAM_WEBHOOK_SECRET` | For Telegram | Random 16-256 chars (`A-Z a-z 0-9 _ -`), web server. Authenticates Telegram's webhook calls. |
| `TELEGRAM_CHAT_ID` | Optional | Operator chat for pipeline-failure alerts. Users connect their own chats in Settings. |
| `SEMANTIC_SCHOLAR_API_KEY` | Optional | Graph API key from https://www.semanticscholar.org/product/api (bypasses unauthenticated rate limits). |
| `BREVO_API_KEY` | Optional | Brevo API key for email digests and deadline alerts (sent to each user's sign-in email). |
| `BREVO_SENDER_EMAIL` | Optional | Verified sender email configured in Brevo dashboard. |
| `BREVO_RECIPIENT_EMAIL` | Optional | Legacy single recipient for the operator's seed profile. |
| `GITHUB_PAT` | For "Scan now" | Fine-grained token with **Actions: write** on this repository (web server). |
| `GITHUB_REPO` | For "Scan now" | `baba-the-beast/research-opportunity-radar` (web server). `GITHUB_REF` overrides the branch (default `main`). |
| `RADAR_API_SECRET` | Optional | Random 32+ char secret for CI/cron callers of the web API (constant-time check). Never prefix with `NEXT_PUBLIC_`. |
| `PROJECT_ROOT` | Docker only | `/app`; used by the legacy in-container `/api/pipeline/stream` route. |

Per-user settings (relevance band, minimum score, sources, channels) live in the database; the old
`MIN_RELEVANCE_BAND` / `DEADLINE_ALERT_WINDOW_DAYS` variables are no longer read.

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

## 3. Supabase Project

- The project URL in `.env` / `web/.env.local` must resolve. (On 2026-09-29 `xsaogsrualkfcbgssdjy.supabase.co`
  returned "non-existent domain": the project was deleted or the id is mistyped.)
- Apply every file in `supabase/migrations/` in filename order, including
  `20261001000000_india_profile_and_sources.sql` (new profile fields and cleanup of old data).
- Give yourself the operator role so the dashboard shows **Scan now**:
  ```sql
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role": "operator"}'
   where email = 'you@example.com';
  ```
  (sign out and in again afterwards).

---

## 4. Go-Live Checklist

1. Supabase URL and keys correct in the web host and as GitHub Actions secrets
   (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CROSSREF_MAILTO`).
2. Migrations applied; run the Supabase security advisor afterwards.
3. Web host: `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (build and runtime).
4. Operator role set (above); `GITHUB_PAT` + `GITHUB_REPO` on the web host for **Scan now**.
5. Run the workflow once from the Actions tab (or **Scan now**) and check `python scripts/probe_sources.py`
   passes for every source.
6. Optional: Brevo (email), Telegram (see README → Telegram Alerts), Gemini/OpenAI (Copilot),
   Upstash (shared rate limits).
