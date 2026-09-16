"""Semantic Scholar API client module.
Docs: https://www.semanticscholar.org/product/api
"""
import time
from typing import Any

import requests
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from radar import config
from radar.logging_config import get_logger

logger = get_logger("semantic_scholar_client")

_last_request_time = 0.0
_circuit_open_until = 0.0


def is_circuit_open() -> bool:
    global _circuit_open_until
    return time.time() < _circuit_open_until


def trip_circuit(duration_seconds: int = 300):
    global _circuit_open_until
    _circuit_open_until = time.time() + duration_seconds


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
    """Search Semantic Scholar papers with rate throttling and circuit breaker."""
    if is_circuit_open():
        logger.warning("Semantic Scholar circuit breaker is OPEN; skipping query to avoid cascade failure.")
        return []

    _throttle()
    headers = {}
    if config.SEMANTIC_SCHOLAR_API_KEY:
        headers["x-api-key"] = config.SEMANTIC_SCHOLAR_API_KEY

    params = {
        "query": query,
        "limit": limit,
        "fields": "title,abstract,authors,venue,year,externalIds,url"
    }

    try:
        res = requests.get(
            "https://api.semanticscholar.org/graph/v1/paper/search",
            params=params,
            headers=headers,
            timeout=15
        )
        if res.status_code == 429:
            retry_after = int(res.headers.get("Retry-After", 120))
            trip_circuit(retry_after)
            logger.warning(f"Semantic Scholar rate-limited (429). Circuit open for {retry_after}s.")
            return []
        res.raise_for_status()
        data = res.json()
        return data.get("data", [])
    except requests.exceptions.RequestException as exc:
        if isinstance(exc, requests.HTTPError) and exc.response is not None and exc.response.status_code == 429:
            trip_circuit(120)
            return []
        raise

