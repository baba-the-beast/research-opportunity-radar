"""BIRAC, CSIR and ICSSR adapters against saved live snapshots (29 Sep 2026)."""
from datetime import date
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

from radar.deadlines.deadline_engine import parse_deadline
from radar.sources.agencies import birac_adapter, csir_adapter, icssr_adapter
from radar.sources.agencies.birac_adapter import current_calls_table, parse_birac_detail, parse_birac_table
from radar.sources.agencies.csir_adapter import parse_csir_announcements
from radar.sources.agencies.icssr_adapter import parse_icssr_announcements, parse_icssr_call_page
from radar.sources.agency_scraper_base import latest_cued_deadline
from radar.sources.http import FetchError
from radar.tools import funding_deadline_scan as scan

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"
TODAY = date(2026, 9, 29)


def _read(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


class _Response:
    def __init__(self, text: str):
        self.text = text


@pytest.fixture(autouse=True)
def frozen_today(monkeypatch):
    for target in (
        "radar.deadlines.deadline_engine.today_ist",
        "radar.tools.funding_deadline_scan.today_ist",
        "radar.sources.agencies.csir_adapter.today_ist",
        "radar.sources.agencies.icssr_adapter.today_ist",
    ):
        monkeypatch.setattr(target, lambda: TODAY)


# --- date phrases seen in these agencies' documents ---------------------------------------------

@pytest.mark.parametrize("text, expected", [
    ("on or before 10 th October 2026", date(2026, 10, 10)),
    ("with cut-off date of 30th September 2026", date(2026, 9, 30)),
    ("Last Date of Submission 15-Jul-2026", date(2026, 7, 15)),
])
def test_agency_date_phrases(text, expected):
    assert parse_deadline(text)[0] == expected


def test_latest_cued_deadline_takes_the_extension():
    text = ("Last Date for Online Application Submission 06.07.2026. Extension of Last Date for Online "
            "Application Submission August 14, 2026. For technical assistance email us.")
    assert latest_cued_deadline(text) == "2026-08-14"


# --- BIRAC ---------------------------------------------------------------------------------------

def test_birac_rows_and_dates():
    html = _read("birac_cfp_2026-09.html")
    assert parse_birac_table(current_calls_table(html)) == []  # no current calls on 29 Sep 2026
    previous = BeautifulSoup(html, "html.parser").find_all("table")[1]
    first = parse_birac_table(previous)[0]
    assert first["url"] == "https://birac.nic.in/cfp_view.php?id=118&scheme_type=6"
    assert first["opens_on"] == "12th May 2026"
    assert first["deadline"] == "15-Jul-2026"


def test_birac_detail_page():
    details = parse_birac_detail(_read("birac_cfp_view_118_2026-09.html"), "Grand Challenges India  GCI  Announces Open Call For Proposals on Breakthrough...")
    assert details["title"].startswith("Grand Challenges India GCI Announces Open Call For Proposals on Breakthrough Solutions")
    assert details["summary"].startswith("This open call under Grand Challenges India")
    assert "Indian academic and research institutions" in details["eligibility_clause"]


def test_birac_listing_without_table_is_an_error(monkeypatch):
    monkeypatch.setattr(birac_adapter, "fetch", lambda url, **kw: _Response("<html><body>maintenance</body></html>"))
    errors: list[dict[str, str]] = []
    assert scan.funding_deadline_scan(["BIRAC"], errors=errors) == []
    assert errors and "layout changed" in errors[0]["error"]


# --- CSIR ----------------------------------------------------------------------------------------

def test_csir_keeps_calls_and_drops_results_and_admin_notices():
    calls = parse_csir_announcements(_read("csir_hrdg_home_2026-09.html"))
    titles = [c["title"] for c in calls]
    assert "Advertisement for Seeking Research Proposal under 'CSIR Emeritus Scientist Scheme'" in titles
    assert any("ASPIRE" in t for t in titles)
    assert not any(word in t for t in titles for word in ("Result", "Cut-off", "Empanelment", "income tax"))
    emeritus = next(c for c in calls if "Emeritus" in c["title"])
    assert emeritus["pdf_url"] and emeritus["published"] == "2026-09-03"


def test_csir_old_rounds_without_dates_are_closed(monkeypatch):
    home = _read("csir_hrdg_home_2026-09.html")

    def fake_fetch(url, **kw):
        if url == csir_adapter.CSIRAdapter.url:
            return _Response(home)
        if "csir-aspire" in url:
            return _Response("<main>CSIR-ASPIRE Last Date for submission of Proposal: 30-04-2023</main>")
        raise FetchError("unexpected")

    monkeypatch.setattr(csir_adapter, "fetch", fake_fetch)
    opps = {o.title: o for o in scan.funding_deadline_scan(["CSIR"])}
    assert "Call for Nomination Bhatnagar Fellowship 2025" not in opps  # 2025 round, no date
    assert not any("ASPIRE" in t for t in opps)  # page says 2023
    emeritus = opps["Advertisement for Seeking Research Proposal under 'CSIR Emeritus Scientist Scheme'"]
    assert emeritus.status == "unknown"  # date comes from its PDF during enrichment


# --- ICSSR ---------------------------------------------------------------------------------------

def test_icssr_announcements():
    calls = parse_icssr_announcements(_read("icssr_home_2026-09.html"))
    by_url = {c["url"]: c for c in calls}
    cfp = by_url["https://icssr.org/indian-social-science-review-call-for-papers"]
    assert cfp["kind"] == "journal" and cfp["published"] == "2026-08-24"
    assert not any("Announcement of the Award" in c["title"] for c in calls)
    assert not any("Essay Writing" in c["title"] for c in calls)


def test_icssr_call_pages():
    yuva = parse_icssr_call_page(_read("icssr_yuva_shodh_2026-09.html"))
    assert yuva["deadline"] == "2026-08-14"  # the extended date, not the original 06.07.2026
    assert yuva["pdf_url"].endswith("Yuva-Shodh-Pratibha-Scheme1.pdf")
    assert parse_icssr_call_page(_read("icssr_issr_cfp_2026-09.html"))["deadline"] == "2026-11-21"


def test_icssr_scan_marks_prose_dates_probable(monkeypatch):
    pages = {
        icssr_adapter.ICSSRAdapter.url: _read("icssr_home_2026-09.html"),
        "https://icssr.org/indian-social-science-review-call-for-papers": _read("icssr_issr_cfp_2026-09.html"),
    }
    monkeypatch.setattr(icssr_adapter, "fetch", lambda url, **kw: _Response(pages[url]) if url in pages else (_ for _ in ()).throw(FetchError("x")))
    opps = {o.title: o for o in scan.funding_deadline_scan(["ICSSR"])}
    special_issue = next(o for t, o in opps.items() if "Special Issue" in t)
    assert special_issue.kind == "journal"
    assert special_issue.deadlines[0].deadline_type == "special_issue"
    assert special_issue.deadlines[0].deadline_date == date(2026, 11, 21)
    assert special_issue.deadlines[0].confidence == "probable"
    # Indo-German call from 2024 has no readable page (fetch failed) and is too old to keep
    assert not any("Indo-German" in t for t in opps)


@pytest.mark.parametrize("url", ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "file:///etc/passwd", "", None])
def test_non_http_links_are_never_stored(url):
    opp, reason = scan._call_to_opportunity({"title": "Call for proposals", "url": url, "deadline": "31-12-2099"}, "DBT")
    assert opp is None and reason == "no_link"


def test_non_http_pdf_links_are_dropped():
    opp, _ = scan._call_to_opportunity(
        {"title": "Call for proposals", "url": "https://dbt.gov.in/c", "pdf_url": "javascript:alert(1)", "deadline": "31-12-2099"}, "DBT"
    )
    assert "pdf_url" not in opp.metadata
