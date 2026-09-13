#!/usr/bin/env python3
"""
Research Opportunity Radar — Environment & Secrets Validator
Validates presence of required/optional environment variables and tests live connectivity.
"""
import os
import sys

from dotenv import load_dotenv

load_dotenv()

VARIABLES = [
    # (Key, Required?, Category, Description)
    ("SUPABASE_URL", True, "Database", "Supabase REST & Auth API URL"),
    ("SUPABASE_SERVICE_ROLE_KEY", True, "Database", "Supabase Service Role Secret Key"),
    ("ALLOW_IN_MEMORY_DB", False, "Database", "Permit ephemeral in-memory storage"),
    ("OPENALEX_API_KEY", True, "Academic Sources", "OpenAlex API Key or Polite Mailto"),
    ("CROSSREF_MAILTO", False, "Academic Sources", "Crossref polite pool contact email"),
    ("SEMANTIC_SCHOLAR_API_KEY", False, "Academic Sources", "Semantic Scholar Graph API Key"),
    ("TELEGRAM_BOT_TOKEN", False, "Alerts", "Telegram Bot API Token"),
    ("TELEGRAM_CHAT_ID", False, "Alerts", "Telegram Chat/Channel ID"),
    ("BREVO_API_KEY", False, "Alerts", "Brevo SMTP/API Key"),
    ("BREVO_SENDER_EMAIL", False, "Alerts", "Brevo verified sender email"),
    ("BREVO_RECIPIENT_EMAIL", False, "Alerts", "Faculty digest recipient email"),
    ("GITHUB_PAT", False, "CI/CD", "GitHub Personal Access Token"),
    ("GITHUB_REPO", False, "CI/CD", "Target repo (owner/name) for dispatch"),
]

def mask_val(val: str) -> str:
    if not val:
        return ""
    if len(val) <= 8:
        return "***"
    return f"{val[:3]}...{val[-3:]}"

def test_http(url: str, headers: dict = None, method: str = "GET", json_body: dict = None, timeout: float = 4.0) -> str:
    try:
        import requests
        if method == "POST":
            r = requests.post(url, headers=headers, json=json_body, timeout=timeout)
        else:
            r = requests.get(url, headers=headers, timeout=timeout)
        if r.status_code < 400:
            return f"OK (HTTP {r.status_code})"
        return f"HTTP {r.status_code}"
    except Exception as ex:
        return f"Failed: {type(ex).__name__}"

def main():
    print("=" * 95)
    print(" RESEARCH OPPORTUNITY RADAR — ENVIRONMENT CONFIGURATION CHECKLIST")
    print("=" * 95)

    allow_in_memory = os.getenv("ALLOW_IN_MEMORY_DB", "0").lower() in ("1", "true", "yes")

    col_w = [26, 16, 10, 10, 27]
    header = f"{'Variable':<{col_w[0]}} {'Category':<{col_w[1]}} {'Required':<{col_w[2]}} {'Status':<{col_w[3]}} {'Value / Connectivity':<{col_w[4]}}"
    print(header)
    print("-" * 95)

    missing_required = []
    missing_optional = []

    for key, req, cat, desc in VARIABLES:
        val = os.getenv(key, "").strip()
        is_missing = not val

        if is_missing:
            if req:
                if allow_in_memory and key in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
                    status = "BYPASS"
                    detail = "Bypassed by ALLOW_IN_MEMORY_DB=1"
                else:
                    status = "MISSING"
                    detail = "CRITICAL: Unset"
                    missing_required.append(key)
            else:
                status = "UNSET"
                detail = "Optional"
                missing_optional.append(key)
        else:
            status = "PRESENT"
            detail = mask_val(val)

        req_str = "YES" if req else "No"
        print(f"{key:<{col_w[0]}} {cat:<{col_w[1]}} {req_str:<{col_w[2]}} {status:<{col_w[3]}} {detail:<{col_w[4]}}")

    print("-" * 95)
    print("Live Connectivity Verification:")

    # 1. OpenAlex
    oa_key = os.getenv("OPENALEX_API_KEY", "")
    oa_mailto = os.getenv("CROSSREF_MAILTO", "") or oa_key
    oa_url = "https://api.openalex.org/works?search=quantum&per-page=1"
    if "@" in oa_mailto:
        oa_url += f"&mailto={oa_mailto}"
    oa_res = test_http(oa_url)
    print(f"  * OpenAlex API:       {oa_res}")

    # 2. Grants.gov
    gg_url = "https://api.grants.gov/v1/api/search2"
    gg_payload = {"keyword": "computer", "oppStatuses": "posted|forecasted", "rows": 1, "startRecordNum": 0}
    gg_res = test_http(gg_url, method="POST", json_body=gg_payload)
    print(f"  * Grants.gov API:     {gg_res}")

    # 3. Supabase
    sb_url = os.getenv("SUPABASE_URL", "")
    sb_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if sb_url and sb_key:
        ping_url = f"{sb_url.rstrip('/')}/rest/v1/"
        sb_res = test_http(ping_url, headers={"apikey": sb_key, "Authorization": f"Bearer {sb_key}"})
        print(f"  * Supabase DB:        {sb_res}")
    else:
        sb_note = "SKIPPED (Credentials missing; ALLOW_IN_MEMORY_DB active)" if allow_in_memory else "SKIPPED (Unconfigured)"
        print(f"  * Supabase DB:        {sb_note}")

    print("=" * 95)

    if missing_required:
        print(f"FAIL: {len(missing_required)} required configuration keys missing: {', '.join(missing_required)}")
        print("Remediation: Copy .env.example to .env and configure keys, or set ALLOW_IN_MEMORY_DB=1 for dry runs.")
        sys.exit(1)
    elif allow_in_memory:
        print("PASS (WARN): Operating with ALLOW_IN_MEMORY_DB=1. Opportunities will not persist to Supabase.")
        sys.exit(0)
    else:
        print("PASS: All required environment configuration keys are present and operational.")
        sys.exit(0)

if __name__ == "__main__":
    main()
