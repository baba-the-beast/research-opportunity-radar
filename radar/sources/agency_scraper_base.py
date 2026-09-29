"""Base compliance, robots.txt verification, and adapter interface for agency scrapers."""
import logging
import urllib.parse
from abc import ABC, abstractmethod
from typing import Any
from urllib.robotparser import RobotFileParser

import requests

from radar.sources.http import HONEST_USER_AGENT, FetchError, ca_bundle

logger = logging.getLogger(__name__)

__all__ = ["HONEST_USER_AGENT", "AgencyAdapter", "FetchError", "is_scraping_allowed"]

ROBOTS_TIMEOUT = 10

_ROBOTS_PARSER_CACHE: dict[str, RobotFileParser] = {}


def reset_robots_cache() -> None:
    """Clears the in-memory robots.txt parser cache for test isolation."""
    _ROBOTS_PARSER_CACHE.clear()


def set_cached_robots_parser(base_url: str, parser: RobotFileParser) -> None:
    """Sets a pre-configured RobotFileParser for a base URL."""
    _ROBOTS_PARSER_CACHE[base_url] = parser


def fetch_robots_lines(robots_url: str) -> list[str] | None:
    """robots.txt lines, [] when the site has none (4xx), None when it could not be fetched."""
    try:
        res = requests.get(robots_url, timeout=ROBOTS_TIMEOUT, headers={"User-Agent": HONEST_USER_AGENT}, verify=ca_bundle())
    except requests.RequestException:
        return None
    if 400 <= res.status_code < 500:
        return []
    if res.status_code != 200:
        return None
    return res.text.splitlines()


def is_scraping_allowed(url: str, user_agent: str = "ResearchOpportunityRadar") -> bool:
    """
    Verifies that the target URL path is compliant with domain robots.txt policy.
    Fails open (returns True) if robots.txt is missing or cannot be fetched.
    """
    try:
        parsed = urllib.parse.urlparse(url)
        base = f"{parsed.scheme}://{parsed.netloc}"
        if base not in _ROBOTS_PARSER_CACHE:
            rp = RobotFileParser()
            rp.set_url(f"{base}/robots.txt")
            lines = fetch_robots_lines(f"{base}/robots.txt")
            if lines is None:
                rp.allow_all = True
            else:
                rp.parse(lines)
            _ROBOTS_PARSER_CACHE[base] = rp
        return _ROBOTS_PARSER_CACHE[base].can_fetch(user_agent, url)
    except Exception:
        return True


class AgencyAdapter(ABC):
    """One funding agency's list of open calls.

    Subclasses implement ``_fetch_calls`` and return dicts with at least ``title``, ``url`` and
    ``deadline`` (raw text or None); optional keys: ``opens_on``, ``pdf_url``, ``summary``, ``rolling``.
    ``fetch_open_calls`` never raises: a failure leaves [] plus a readable ``last_error`` so the
    pipeline can report the source as failed instead of silently "healthy with zero calls".
    """

    agency_name: str
    url: str

    def __init__(self) -> None:
        self.last_error: str | None = None

    def check_robots_allowed(self) -> bool:
        """Verifies with the domain robots.txt policy before scraping."""
        return is_scraping_allowed(self.url)

    def fetch_open_calls(self) -> list[dict[str, Any]]:
        self.last_error = None
        if not self.check_robots_allowed():
            self.last_error = f"robots.txt disallows {self.url}"
            logger.warning(f"{self.agency_name}: {self.last_error}")
            return []
        try:
            return self._fetch_calls()
        except FetchError as exc:
            self.last_error = str(exc)
        except Exception as exc:  # parsing bug or page redesign: report, don't crash the run
            self.last_error = f"could not parse {self.url}: {exc.__class__.__name__}: {exc}"
        logger.error(f"{self.agency_name} adapter failed: {self.last_error}")
        return []

    @abstractmethod
    def _fetch_calls(self) -> list[dict[str, Any]]:
        """Return raw call dicts. May raise FetchError."""
