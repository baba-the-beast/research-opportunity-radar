"""Base compliance, robots.txt verification, and adapter interface for academic scrapers."""
import urllib.parse
from abc import ABC, abstractmethod
from typing import Any
from urllib.robotparser import RobotFileParser

HONEST_USER_AGENT = "ResearchOpportunityRadar/1.0 (+https://github.com/org/repo; contact: faculty@institution.edu)"

_ROBOTS_PARSER_CACHE: dict[str, RobotFileParser] = {}


def reset_robots_cache() -> None:
    """Clears the in-memory robots.txt parser cache for test isolation."""
    global _ROBOTS_PARSER_CACHE
    _ROBOTS_PARSER_CACHE.clear()


def set_cached_robots_parser(base_url: str, parser: RobotFileParser) -> None:
    """Sets a pre-configured RobotFileParser for a base URL."""
    _ROBOTS_PARSER_CACHE[base_url] = parser


def is_scraping_allowed(url: str, user_agent: str = "ResearchOpportunityRadar") -> bool:
    """
    Verifies that the target URL path is compliant with domain robots.txt policy.
    Fails open (returns True) if robots.txt cannot be fetched or parsed.
    """
    try:
        parsed = urllib.parse.urlparse(url)
        base = f"{parsed.scheme}://{parsed.netloc}"
        if base not in _ROBOTS_PARSER_CACHE:
            rp = RobotFileParser()
            rp.set_url(f"{base}/robots.txt")
            try:
                rp.read()
            except Exception:
                # Under fail-open semantics (RFC 9309), failure to retrieve robots.txt permits crawling
                rp.allow_all = True
            _ROBOTS_PARSER_CACHE[base] = rp
        return _ROBOTS_PARSER_CACHE[base].can_fetch(user_agent, url)
    except Exception:
        return True


class AgencyAdapter(ABC):
    agency_name: str
    url: str

    def check_robots_allowed(self) -> bool:
        """Verifies with the domain robots.txt policy before scraping."""
        return is_scraping_allowed(self.url)

    @abstractmethod
    def fetch_open_calls(self) -> list[dict[str, Any]]:
        """Return raw dicts with at minimum: title, url, deadline (str|None)."""
        pass
