"""Shared HTTP fetching for agency scrapers: honest User-Agent, rate limiting, retries, and TLS that
verifies Indian government sites which serve incomplete certificate chains.

Several gov.in sites send a leaf certificate without the intermediate that links it to a trusted root
(browsers fetch the missing piece themselves; Python does not). Instead of turning verification off,
we append those intermediates (radar/sources/certs/extra_intermediates.pem) to certifi's root bundle.
"""
import atexit
import os
import tempfile
from pathlib import Path

import certifi
import requests
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from radar.sources.rate_limiter import scraper_limiter

HONEST_USER_AGENT = "ResearchOpportunityRadar/1.0 (+https://github.com/baba-the-beast/research-opportunity-radar)"
DEFAULT_TIMEOUT = 25
MAX_BYTES = 10 * 1024 * 1024  # listing pages and call PDFs larger than this are not worth parsing

_EXTRA_CERTS = Path(__file__).parent / "certs" / "extra_intermediates.pem"
_ca_bundle_path: str | None = None


def ca_bundle() -> str:
    """Path to certifi's roots plus the bundled intermediates, built once per process."""
    global _ca_bundle_path
    if _ca_bundle_path and os.path.exists(_ca_bundle_path):
        return _ca_bundle_path
    handle, path = tempfile.mkstemp(prefix="radar-ca-", suffix=".pem")
    with os.fdopen(handle, "w", encoding="utf-8") as out:
        out.write(Path(certifi.where()).read_text(encoding="utf-8"))
        if _EXTRA_CERTS.exists():
            out.write("\n")
            out.write(_EXTRA_CERTS.read_text(encoding="utf-8"))
    atexit.register(lambda: os.path.exists(path) and os.remove(path))
    _ca_bundle_path = path
    return path


def is_http_url(url: str | None) -> bool:
    """Only http(s) links are stored or followed: a scraped href such as "javascript:..." or
    "file:..." would otherwise pass through urljoin() unchanged and end up as a clickable link."""
    if not url:
        return False
    scheme = url.split(":", 1)[0].strip().lower()
    return scheme in ("http", "https") and "://" in url


class FetchError(Exception):
    """A source could not be fetched; the message is safe to show in run logs."""


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, (requests.ConnectionError, requests.Timeout)) and not isinstance(exc, requests.exceptions.SSLError):
        return True
    return isinstance(exc, _RetryableStatus)


class _RetryableStatus(Exception):
    def __init__(self, response: requests.Response):
        super().__init__(f"HTTP {response.status_code}")
        self.response = response


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=0.5, min=0.5, max=4), retry=retry_if_exception(_is_retryable), reraise=True)
def _get(url: str, timeout: int, headers: dict[str, str] | None) -> requests.Response:
    scraper_limiter.wait()
    response = requests.get(
        url,
        timeout=timeout,
        headers={"User-Agent": HONEST_USER_AGENT, **(headers or {})},
        verify=ca_bundle(),
        stream=True,
    )
    if response.status_code == 429 or response.status_code >= 500:
        raise _RetryableStatus(response)
    return response


def fetch(url: str, timeout: int = DEFAULT_TIMEOUT, headers: dict[str, str] | None = None) -> requests.Response:
    """GET a URL for scraping. Raises FetchError on network/TLS failure, non-200 status, or oversize body."""
    try:
        response = _get(url, timeout, headers)
    except requests.exceptions.SSLError as exc:
        raise FetchError(f"TLS verification failed for {url}: {exc.__class__.__name__}") from exc
    except _RetryableStatus as exc:
        raise FetchError(f"{url} returned HTTP {exc.response.status_code}") from exc
    except requests.RequestException as exc:
        raise FetchError(f"Could not reach {url}: {exc.__class__.__name__}") from exc

    if response.status_code != 200:
        raise FetchError(f"{url} returned HTTP {response.status_code}")

    body = b""
    for chunk in response.iter_content(64 * 1024):
        body += chunk
        if len(body) > MAX_BYTES:
            response.close()
            raise FetchError(f"{url} is larger than {MAX_BYTES // (1024 * 1024)} MB")
    response._content = body
    response._content_consumed = True
    return response
