"""Grants.gov API client module.
Docs: https://api.grants.gov
"""
from typing import Any

import requests
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from radar.sources.rate_limiter import grants_gov_limiter


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type(requests.HTTPError),
    reraise=True
)
def search_opportunities(keyword: str, rows: int = 50) -> list[dict[str, Any]]:
    """Search Grants.gov funding opportunities."""
    payload = {
        "keyword": keyword,
        "oppStatuses": "posted|forecasted",
        "rows": rows,
        "startRecordNum": 0
    }
    headers = {
        "Content-Type": "application/json"
    }
    grants_gov_limiter.wait()
    res = requests.post("https://api.grants.gov/v1/api/search2", json=payload, headers=headers, timeout=15)
    res.raise_for_status()
    data = res.json()
    return data.get("data", {}).get("oppHits", [])
