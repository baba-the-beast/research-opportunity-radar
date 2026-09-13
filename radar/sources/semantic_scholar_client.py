"""Semantic Scholar API client module.
Docs: https://www.semanticscholar.org/product/api
"""
import time
from typing import Any

import requests
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from radar import config

_last_request_time = 0.0

def _throttle():
    global _last_request_time
    if not config.SEMANTIC_SCHOLAR_API_KEY:
        elapsed = time.time() - _last_request_time
        if elapsed < 1.0:
            time.sleep(1.0 - elapsed)
        _last_request_time = time.time()

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type(requests.HTTPError),
    reraise=True
)
def search_papers(query: str, limit: int = 25) -> list[dict[str, Any]]:
    """Search Semantic Scholar papers with optional rate throttling."""
    _throttle()
    headers = {}
    if config.SEMANTIC_SCHOLAR_API_KEY:
        headers["x-api-key"] = config.SEMANTIC_SCHOLAR_API_KEY

    params = {
        "query": query,
        "limit": limit,
        "fields": "title,abstract,authors,venue,year,externalIds,url"
    }

    res = requests.get("https://api.semanticscholar.org/graph/v1/paper/search", params=params, headers=headers, timeout=15)
    res.raise_for_status()
    data = res.json()
    return data.get("data", [])
