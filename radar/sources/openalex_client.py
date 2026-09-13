"""OpenAlex API client module.
Docs: https://developers.openalex.org
"""
from typing import Any

import requests
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from radar import config
from radar.sources.rate_limiter import openalex_limiter


class OpenAlexHTTPError(Exception):
    pass

def _is_retryable_status(exception: Exception) -> bool:
    if isinstance(exception, requests.HTTPError) and exception.response is not None:
        return exception.response.status_code in (429, 500, 502, 503, 504)
    return False

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type(requests.HTTPError),
    reraise=True
)
def search_works(query: str, per_page: int = 25) -> list[dict[str, Any]]:
    """Search OpenAlex works for a given query string."""
    params = {
        "search": query,
        "per_page": per_page
    }
    if config.OPENALEX_API_KEY:
        if "@" in config.OPENALEX_API_KEY:
            params["mailto"] = config.OPENALEX_API_KEY
        else:
            params["api_key"] = config.OPENALEX_API_KEY

    openalex_limiter.wait()
    res = requests.get("https://api.openalex.org/works", params=params, timeout=15)
    res.raise_for_status()
    data = res.json()
    return data.get("results", [])

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type(requests.HTTPError),
    reraise=True
)
def get_work_by_id(openalex_id: str) -> dict[str, Any]:
    """Retrieve a single work by OpenAlex ID."""
    clean_id = openalex_id.split("/")[-1]
    params = {}
    if config.OPENALEX_API_KEY:
        if "@" in config.OPENALEX_API_KEY:
            params["mailto"] = config.OPENALEX_API_KEY
        else:
            params["api_key"] = config.OPENALEX_API_KEY
    openalex_limiter.wait()
    res = requests.get(f"https://api.openalex.org/works/{clean_id}", params=params, timeout=15)
    res.raise_for_status()
    return res.json()
