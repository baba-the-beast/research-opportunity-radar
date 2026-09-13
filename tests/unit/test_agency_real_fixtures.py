"""Tests asserting that ICMR and DBT adapters correctly parse real saved fixtures."""
import json
from pathlib import Path

import pytest

from radar.sources.agencies.dbt_adapter import DBTAdapter
from radar.sources.agencies.icmr_adapter import ICMRAdapter
from radar.sources.agency_scraper_base import set_cached_robots_parser

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"


class MockResponse:
    def __init__(self, content: bytes, status_code: int = 200, is_json: bool = False):
        self.content = content
        self.text = content.decode("utf-8", errors="replace")
        self.status_code = status_code
        self._is_json = is_json

    def json(self):
        if self._is_json:
            return json.loads(self.text)
        raise ValueError("Not JSON")


@pytest.fixture(autouse=True)
def allow_all_robots():
    import urllib.robotparser
    rp = urllib.robotparser.RobotFileParser()
    rp.parse(["User-agent: *", "Allow: /", "Disallow:"])
    set_cached_robots_parser("https://www.icmr.gov.in", rp)
    set_cached_robots_parser("https://dbt.gov.in", rp)


def test_icmr_adapter_parses_real_fixture(monkeypatch):
    fixture_path = FIXTURES_DIR / "icmr_notices_2026-09.html"
    assert fixture_path.exists(), "ICMR real fixture missing"

    raw_html = fixture_path.read_bytes()
    monkeypatch.setattr(
        "radar.sources.agencies.icmr_adapter._fetch_icmr_page",
        lambda url: MockResponse(raw_html, 200, is_json=False)
    )

    adapter = ICMRAdapter()
    calls = adapter.fetch_open_calls()

    assert len(calls) >= 5, f"Expected >= 5 ICMR calls, got {len(calls)}"

    for c in calls:
        assert c["title"], "Title must not be empty"
        assert not c["title"].startswith("Open Document"), "Title should be the call title, not 'Open Document'"
        assert c["url"].startswith("https://www.icmr.gov.in/"), f"URL {c['url']} must start with ICMR domain"

    # Verify specific known calls from live fixture
    intramural = next((c for c in calls if "ICMR-Intramural Research Program" in c["title"]), None)
    assert intramural is not None
    assert intramural["deadline"] == "Sept. 30, 2026"
    assert intramural["url"].endswith(".pdf")


def test_dbt_adapter_parses_real_json_fixture(monkeypatch):
    fixture_path = FIXTURES_DIR / "dbt_notices_2026-09.json"
    assert fixture_path.exists(), "DBT real fixture missing"

    raw_json = fixture_path.read_bytes()
    monkeypatch.setattr(
        "radar.sources.agencies.dbt_adapter._fetch_dbt_page",
        lambda url: MockResponse(raw_json, 200, is_json=True)
    )

    adapter = DBTAdapter()
    calls = adapter.fetch_open_calls()

    assert len(calls) >= 10, f"Expected >= 10 DBT calls, got {len(calls)}"

    for c in calls:
        assert c["title"], "Title must not be empty"
        assert c["url"].startswith("https://dbt.gov.in/"), f"URL {c['url']} must start with DBT domain"

    # Verify specific known calls from live fixture
    kisan = next((c for c in calls if "DBT-Biotech KISAN" in c["title"]), None)
    assert kisan is not None
    assert kisan["deadline"] == "27-04-2026"
    assert kisan["url"].endswith(".pdf")
