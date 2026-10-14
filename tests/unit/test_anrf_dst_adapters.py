"""ANRF and DST adapters against saved live snapshots (ANRF 29 Sep 2026, DST 13 Oct 2026)."""
import json
from datetime import date
from pathlib import Path

import pytest

from radar.sources.agencies import anrf_adapter
from radar.sources.agencies import gov_cms_adapter as dst_adapter
from radar.sources.agencies.anrf_adapter import ANRFAdapter, parse_scheme_js
from radar.sources.agencies.gov_cms_adapter import DSTAdapter, parse_gov_cms_posts
from radar.sources.http import FetchError
from radar.tools import funding_deadline_scan as scan

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"
TODAY = date(2026, 9, 29)


class _Response:
    def __init__(self, text: str = "", payload=None):
        self.text = text
        self._payload = payload

    def json(self):
        return self._payload


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
    detail = (FIXTURES / "anrf_inrg_detail_2026-10.html").read_text(encoding="utf-8")
    monkeypatch.setattr(anrf_adapter, "fetch", lambda url, **kw: _Response(files.get(url, detail)))


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


def test_anrf_detail_page_gives_eligibility_text():
    details = anrf_adapter.parse_anrf_detail((FIXTURES / "anrf_inrg_detail_2026-10.html").read_text(encoding="utf-8"))
    assert details["eligibility_clause"].startswith("Eligibility: The applicant should be an Indian National.")
    assert "superannuation" in details["eligibility_clause"]
    assert details["summary"].startswith("Inclusivity Research Grant")


def test_anrf_calls_carry_their_page_text(frozen_today, anrf_snapshot):
    calls = ANRFAdapter().fetch_open_calls()
    dated = [c for c in calls if c.get("deadline")]
    assert dated and all(c.get("eligibility_clause") for c in dated)


def test_anrf_fetch_failure_is_reported(monkeypatch):
    def boom(url, **kw):
        raise FetchError("https://anrfonline.in returned HTTP 503")

    monkeypatch.setattr(anrf_adapter, "fetch", boom)
    errors: list[dict[str, str]] = []
    assert scan.funding_deadline_scan(["ANRF"], errors=errors) == []
    assert errors == [{"source": "ANRF", "error": "https://anrfonline.in returned HTTP 503"}]


def _dst_news():
    return json.loads((FIXTURES / "dst_whats_new_2026-10.json").read_text(encoding="utf-8"))


def _dst_api(monkeypatch, calls_payload=None, news_payload=None):
    def fake_fetch(url, **kw):
        if url == DSTAdapter.base + dst_adapter.CALLS_PATH:
            return _Response(payload=calls_payload if calls_payload is not None else {"posts": [], "total_items": 0})
        if url == DSTAdapter.base + dst_adapter.NEWS_PATH:
            return _Response(payload=news_payload if news_payload is not None else _dst_news())
        if "post-page/post?id=" in url:
            file_id = url.rsplit("=", 1)[1]
            return _Response(payload={"posts": {"acf_data": {"pdf": {"url": f"https://www.dst.gov.in/static/uploads/{file_id}.pdf"}}}})
        raise AssertionError(url)

    monkeypatch.setattr(dst_adapter, "fetch", fake_fetch)


def test_dst_news_keeps_calls_and_drops_job_adverts():
    calls = parse_gov_cms_posts(_dst_news()["posts"], from_news=True)
    titles = [c["title"] for c in calls]
    assert "Call for applications for ASEAN-India Research Training Fellowships" in titles
    assert "SERB Research Scientist Scheme" in titles
    assert not any("posts of" in t or "Director" in t or "(Form)" in t for t in titles)
    asean = next(c for c in calls if c["title"].startswith("Call for applications for ASEAN"))
    assert asean["url"] == "https://aistic.gov.in/ASEAN/aistdfFellowship"
    assert asean["published"] == "2026-02-03"


def test_dst_drops_stale_announcements_without_a_deadline(monkeypatch):
    # The fixture's calls were posted in Feb 2026, more than MAX_AGE_DAYS before 13 Oct 2026
    monkeypatch.setattr(dst_adapter, "today_ist", lambda: date(2026, 10, 13))
    _dst_api(monkeypatch)
    adapter = DSTAdapter()
    assert adapter.fetch_open_calls() == []
    assert adapter.last_error is None


def test_dst_recent_calls_get_their_pdf(monkeypatch):
    monkeypatch.setattr(dst_adapter, "today_ist", lambda: date(2026, 3, 1))
    _dst_api(monkeypatch)
    calls = DSTAdapter().fetch_open_calls()
    stem = next(c for c in calls if c["title"] == "Call for proposal under Innovation & STEM Demonstration")
    assert stem["pdf_url"] and stem["url"] == stem["pdf_url"]
    assert len({c["url"] for c in calls}) == len(calls)  # every call has its own URL


def test_dst_api_change_is_reported_not_silent(monkeypatch):
    _dst_api(monkeypatch, news_payload={"unexpected": True})
    adapter = DSTAdapter()
    assert adapter.fetch_open_calls() == []
    assert adapter.last_error and "site API changed" in adapter.last_error
