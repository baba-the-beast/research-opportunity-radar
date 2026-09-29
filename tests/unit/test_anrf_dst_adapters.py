"""ANRF and DST adapters against saved live snapshots (29 Sep 2026)."""
from datetime import date
from pathlib import Path

import pytest

from radar.sources.agencies import anrf_adapter, dst_adapter
from radar.sources.agencies.anrf_adapter import ANRFAdapter, parse_scheme_js
from radar.sources.agencies.dst_adapter import DSTAdapter, parse_dst_calls
from radar.sources.http import FetchError
from radar.tools import funding_deadline_scan as scan

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"
TODAY = date(2026, 9, 29)


class _Response:
    def __init__(self, text: str):
        self.text = text


@pytest.fixture
def frozen_today(monkeypatch):
    monkeypatch.setattr(anrf_adapter, "today_ist", lambda: TODAY)
    monkeypatch.setattr(scan, "today_ist", lambda: TODAY)
    monkeypatch.setattr("radar.deadlines.deadline_engine.today_ist", lambda: TODAY)


@pytest.fixture
def anrf_snapshot(monkeypatch):
    files = {
        anrf_adapter.DATED_CALLS_URL: (FIXTURES / "anrf_schemeinterval_2026-09.js").read_text(encoding="utf-8"),
        anrf_adapter.ROLLING_CALLS_URL: (FIXTURES / "anrf_schemeintervalnew_2026-09.js").read_text(encoding="utf-8"),
    }
    monkeypatch.setattr(anrf_adapter, "fetch", lambda url, **kw: _Response(files[url]))


def test_parse_scheme_js_reads_every_item():
    items = parse_scheme_js((FIXTURES / "anrf_schemeinterval_2026-09.js").read_text(encoding="utf-8"))
    assert len(items) > 20
    assert items[0][:2] == ["Prime Minister Professorship", "PMP"]


def test_anrf_returns_only_current_calls_with_iso_deadlines(frozen_today, anrf_snapshot):
    calls = ANRFAdapter().fetch_open_calls()
    dated = {c["title"]: c for c in calls if not c.get("rolling")}

    assert dated["Prime Minister Professorship"]["deadline"] == "2026-10-15"
    assert dated["Prime Minister Professorship"]["url"] == "https://anrfonline.in/ANRF/PMProfessorship_anrf?HomePage=New"
    assert dated["Ramanujan Fellowship"]["deadline"] == "2026-12-31"
    # History (e.g. the 2025 PM Professorship round) is dropped
    assert all(c["deadline"] >= TODAY.isoformat() for c in dated.values())

    rolling = [c["title"] for c in calls if c.get("rolling")]
    assert "International Travel Support (ITS)" in rolling


def test_anrf_scan_produces_confirmed_deadlines(frozen_today, anrf_snapshot):
    opps = {o.title: o for o in scan.funding_deadline_scan(["DST-SERB"])}  # old name maps to ANRF
    pmp = opps["Prime Minister Professorship"]
    assert pmp.agency_or_publisher == "ANRF"
    assert pmp.status == "open"
    assert pmp.deadlines[0].deadline_date == date(2026, 10, 15)
    assert pmp.deadlines[0].confidence == "confirmed"
    assert opps["Seminar/Symposia"].status == "open"
    assert opps["Seminar/Symposia"].deadlines == []


def test_anrf_fetch_failure_is_reported(monkeypatch):
    def boom(url, **kw):
        raise FetchError("https://anrfonline.in returned HTTP 503")

    monkeypatch.setattr(anrf_adapter, "fetch", boom)
    errors: list[dict[str, str]] = []
    assert scan.funding_deadline_scan(["ANRF"], errors=errors) == []
    assert errors == [{"source": "ANRF", "error": "https://anrfonline.in returned HTTP 503"}]


def test_dst_parses_call_table():
    calls = parse_dst_calls((FIXTURES / "dst_archive_calls_2026-09.html").read_text(encoding="utf-8"))
    assert len(calls) == 6
    base = next(c for c in calls if c["title"] == "Bhaskara Advanced Solar Energy Fellowship Program")
    assert base["url"] == "https://dst.gov.in/callforproposals/bhaskara-advanced-solar-energy-fellowship-program"
    assert base["pdf_url"] == "https://dst.gov.in/sites/default/files/BASE-Program-Flyer-2017.pdf"
    assert base["opens_on"] == "19/01/2017"
    assert base["deadline"] == "15/03/2017"


def test_dst_empty_listing_is_not_menu_links(monkeypatch):
    html = (FIXTURES / "dst_calls_empty_2026-09.html").read_text(encoding="utf-8")
    monkeypatch.setattr(dst_adapter, "fetch", lambda url, **kw: _Response(html))
    adapter = DSTAdapter()
    assert adapter.fetch_open_calls() == []
    assert adapter.last_error is None


def test_dst_archive_calls_are_closed(frozen_today, monkeypatch):
    html = (FIXTURES / "dst_archive_calls_2026-09.html").read_text(encoding="utf-8")
    monkeypatch.setattr(dst_adapter, "fetch", lambda url, **kw: _Response(html))
    assert scan.funding_deadline_scan(["DST"]) == []
