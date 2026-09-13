"""Configuration management module reading environment variables and validating required secrets."""
import os

from dotenv import load_dotenv

load_dotenv()

# Database
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
ALLOW_IN_MEMORY_DB = os.getenv("ALLOW_IN_MEMORY_DB", "0").lower() in ("1", "true", "yes")

# Academic Data Sources
OPENALEX_API_KEY = os.getenv("OPENALEX_API_KEY", "")
CROSSREF_MAILTO = os.getenv("CROSSREF_MAILTO", "")
SEMANTIC_SCHOLAR_API_KEY = os.getenv("SEMANTIC_SCHOLAR_API_KEY", "")

# Notification & Alerting
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

BREVO_API_KEY = os.getenv("BREVO_API_KEY", "")
BREVO_SENDER_EMAIL = os.getenv("BREVO_SENDER_EMAIL", "")
BREVO_RECIPIENT_EMAIL = os.getenv("BREVO_RECIPIENT_EMAIL", "")

# Tunables
MIN_RELEVANCE_BAND = os.getenv("MIN_RELEVANCE_BAND", "watch")
DEADLINE_ALERT_WINDOW_DAYS = int(os.getenv("DEADLINE_ALERT_WINDOW_DAYS", "30"))
AGENCY_LIST = ["Grants.gov", "DST-SERB", "ICMR", "DBT"]


class ConfigurationError(Exception):
    """Raised when required environment configuration or API keys are missing."""
    pass


REQUIRED_SECRETS: list[dict[str, str]] = [
    {
        "key": "SUPABASE_URL",
        "name": "Supabase Project URL",
        "purpose": "Database endpoint for opportunities, logs, faculty profile, and calendar sync.",
        "source": "https://supabase.com/dashboard/project/<id>/settings/api"
    },
    {
        "key": "SUPABASE_SERVICE_ROLE_KEY",
        "name": "Supabase Service Role Secret Key",
        "purpose": "Bypasses Row Level Security (RLS) for backend pipeline writes and agent state updates.",
        "source": "https://supabase.com/dashboard/project/<id>/settings/api"
    },
    {
        "key": "OPENALEX_API_KEY",
        "name": "OpenAlex API Key or Polite Pool Mailto",
        "purpose": "Authorizes OpenAlex academic discovery queries without hitting anonymous rate limits.",
        "source": "https://openalex.org (or supply institutional email in OPENALEX_API_KEY / CROSSREF_MAILTO)"
    }
]


def validate_required_config() -> None:
    """
    Validates that all required environment variables are set.
    If ALLOW_IN_MEMORY_DB=1 is set, database credential checks are skipped.
    Otherwise, raises ConfigurationError with a combined summary of all missing keys.
    """
    global ALLOW_IN_MEMORY_DB, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENALEX_API_KEY
    # Refresh in case environment changed dynamically
    ALLOW_IN_MEMORY_DB = os.getenv("ALLOW_IN_MEMORY_DB", "0").lower() in ("1", "true", "yes")
    SUPABASE_URL = os.getenv("SUPABASE_URL", "")
    SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    OPENALEX_API_KEY = os.getenv("OPENALEX_API_KEY", "")

    missing = []
    for item in REQUIRED_SECRETS:
        key = item["key"]
        val = os.getenv(key, "")
        if ALLOW_IN_MEMORY_DB and key in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
            continue
        if not val or val.strip() == "":
            missing.append(item)

    if missing:
        lines = [
            "=" * 80,
            "CRITICAL CONFIGURATION ERROR: MISSING REQUIRED SECRETS",
            "=" * 80,
            "The following required configuration keys are unset in your environment:\n"
        ]
        for idx, item in enumerate(missing, 1):
            lines.append(f"  {idx}. {item['key']} ({item['name']})")
            lines.append(f"     Purpose: {item['purpose']}")
            lines.append(f"     Where to get: {item['source']}\n")

        lines.extend([
            "Remediation Steps:",
            "  1. Copy .env.example to .env:  cp .env.example .env",
            "  2. Populate the required keys in .env",
            "  3. For volatile dry-run testing or CI unit tests without live Supabase, set:",
            "       ALLOW_IN_MEMORY_DB=1",
            "=" * 80
        ])
        error_message = "\n".join(lines)
        raise ConfigurationError(error_message)
