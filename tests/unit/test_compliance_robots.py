import urllib.error
from urllib.robotparser import RobotFileParser

from radar.sources.agency_scraper_base import (
    AgencyAdapter,
    is_scraping_allowed,
    reset_robots_cache,
)


class DummyAdapter(AgencyAdapter):
    agency_name = "Dummy"
    url = "https://mock-agency.gov/calls/proposals"

    def fetch_open_calls(self):
        return []


def test_is_scraping_allowed_disallows_path(monkeypatch):
    reset_robots_cache()

    def mock_read(self):
        self.parse([
            "User-agent: *",
            "Disallow: /calls/",
        ])

    monkeypatch.setattr(RobotFileParser, "read", mock_read)
    allowed = is_scraping_allowed("https://mock-agency.gov/calls/proposals")
    assert allowed is False


def test_is_scraping_allowed_allows_permitted_path(monkeypatch):
    reset_robots_cache()

    def mock_read(self):
        self.parse([
            "User-agent: *",
            "Disallow: /private/",
            "Allow: /calls/",
        ])

    monkeypatch.setattr(RobotFileParser, "read", mock_read)
    allowed = is_scraping_allowed("https://mock-agency.gov/calls/proposals")
    assert allowed is True


def test_is_scraping_allowed_fails_open_on_network_error(monkeypatch):
    reset_robots_cache()

    def mock_read_error(self):
        raise urllib.error.URLError("DNS resolution failure / Sandbox network blocked")

    monkeypatch.setattr(RobotFileParser, "read", mock_read_error)
    allowed = is_scraping_allowed("https://unreachable-site.org/calls")
    # Fail-open compliance: unresolvable or 404 robots.txt permits crawling
    assert allowed is True


def test_agency_adapter_check_robots_allowed(monkeypatch):
    reset_robots_cache()

    def mock_read(self):
        self.parse([
            "User-agent: *",
            "Disallow: /other/",
        ])

    monkeypatch.setattr(RobotFileParser, "read", mock_read)
    adapter = DummyAdapter()
    assert adapter.check_robots_allowed() is True


def test_nsf_full_ruleset_compliance():
    """Verifies that under the authentic full NSF ruleset, RSS is allowed while restricted paths are disallowed."""
    # Under MOCK_ROBOTS_BY_HOST["https://www.nsf.gov"]
    assert is_scraping_allowed("https://www.nsf.gov/rss/rss_www_funding.xml") is True
    assert is_scraping_allowed("https://www.nsf.gov/funding/opps") is False
    assert is_scraping_allowed("https://www.nsf.gov/careers/openings") is False
    assert is_scraping_allowed("https://www.nsf.gov/admin/dashboard") is False


def test_anti_truncation_sanity_check_flags_short_file():
    """Verifies that validate_robots_sanity flags a truncated robots.txt response as a failure."""
    from scripts.verify_live_robots_compliance import TARGET_SOURCES, validate_robots_sanity

    nsf_source = next(s for s in TARGET_SOURCES if s["domain"] == "nsf.gov")
    truncated_text = "User-agent: *\nDisallow: /admin/\nDisallow: /search/\n"
    passed, msg = validate_robots_sanity(nsf_source, truncated_text, truncated_text.encode("utf-8"), 200)

    assert passed is False
    assert "TRUNCATION SUSPECTED" in msg


def test_anti_truncation_sanity_check_flags_content_length_mismatch():
    """Verifies that validate_robots_sanity flags Content-Length header mismatches as a failure."""
    from scripts.verify_live_robots_compliance import TARGET_SOURCES, validate_robots_sanity

    wikicfp_source = next(s for s in TARGET_SOURCES if s["domain"] == "wikicfp.com")
    text = "User-agent: *\nDisallow:\n"
    raw_bytes = text.encode("utf-8")
    # Declared 321 bytes, but only provided 24 bytes
    passed, msg = validate_robots_sanity(wikicfp_source, text, raw_bytes, 200, content_length_header=321)

    assert passed is False
    assert "Content-Length header mismatch" in msg


def test_wildcard_allow_and_disallow_rules_enforced(monkeypatch):
    """Verifies that a wildcard User-agent: * block containing both Allow and Disallow enforces both correctly."""
    reset_robots_cache()

    def mock_read(self):
        self.parse([
            "User-agent: *",
            "Allow: /rss/",
            "Allow: /public/call",
            "Disallow: /admin/",
            "Disallow: /funding/opps",
        ])

    monkeypatch.setattr(RobotFileParser, "read", mock_read)
    assert is_scraping_allowed("https://mock-agency.gov/rss/feed.xml") is True
    assert is_scraping_allowed("https://mock-agency.gov/public/call") is True
    assert is_scraping_allowed("https://mock-agency.gov/admin/console") is False
    assert is_scraping_allowed("https://mock-agency.gov/funding/opps") is False


def test_empty_robots_and_dbt_style_allow_scraping(monkeypatch):
    """Verifies that genuinely empty robots.txt and DBT-style 'Disallow:' both permit crawling."""
    # Case A: DBT-style User-agent: * with empty Disallow:
    reset_robots_cache()

    def mock_read_dbt(self):
        self.parse([
            "User-agent: *",
            "Disallow:",
        ])

    monkeypatch.setattr(RobotFileParser, "read", mock_read_dbt)
    assert is_scraping_allowed("https://dbt.gov.in/data-view?name=call-for-proposals") is True

    # Case B: Genuinely empty robots.txt (0 rules)
    reset_robots_cache()

    def mock_read_empty(self):
        self.parse([])

    monkeypatch.setattr(RobotFileParser, "read", mock_read_empty)
    assert is_scraping_allowed("https://empty-robots-agency.gov/calls") is True



