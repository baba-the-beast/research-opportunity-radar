"""Crossref API client module.
Docs: https://github.com/CrossRef/rest-api-doc
"""
from typing import Any

import requests
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from radar import config
from radar.sources.rate_limiter import crossref_limiter


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type(requests.HTTPError),
    reraise=True
)
def search_works(query: str, per_page: int = 25) -> list[dict[str, Any]]:
    """Search Crossref works for a query string."""
    params = {
        "query": query,
        "rows": per_page
    }
    if config.CROSSREF_MAILTO:
        params["mailto"] = config.CROSSREF_MAILTO

    crossref_limiter.wait()
    res = requests.get("https://api.crossref.org/works", params=params, timeout=15)
    res.raise_for_status()
    data = res.json()
    message = data.get("message", {})
    return message.get("items", [])

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type(requests.HTTPError),
    reraise=True
)
def get_work_by_id(doi: str) -> dict[str, Any]:
    """Retrieve a work by DOI from Crossref."""
    params = {}
    if config.CROSSREF_MAILTO:
        params["mailto"] = config.CROSSREF_MAILTO
    crossref_limiter.wait()
    res = requests.get(f"https://api.crossref.org/works/{doi}", params=params, timeout=15)
    res.raise_for_status()
    data = res.json()
    return data.get("message", {})
