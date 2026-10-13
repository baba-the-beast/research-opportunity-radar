"""The configurable listing adapter and the funders it covers."""
import pytest

from radar import config
from radar.sources.agencies import gov_cms_adapter, listing_adapter
from radar.sources.agencies.gov_cms_adapter import MoESAdapter
from radar.sources.agencies.listing_adapter import ListingAdapter, ListingSource, call_pdf, parse_listing
from radar.sources.agency_scraper_base import latest_cued_deadline
from radar.tools.funding_deadline_scan import AGENCY_REGISTRY

PAGE = """
<html><body>
<nav><a href="/call-in-menu">Call for Proposals (menu)</a></nav>
<main><ul>
  <li><a href="/notices/irg.pdf">Call for Proposals under Inclusivity Research Grant 2026</a> Last date: 30 November 2026</li>
  <li><a href="/notices/fellowship">Applications invited for the Young Scientist Fellowship</a></li>
  <li><a href="/notices/jobs.pdf">Applications invited for posts of Project Scientist</a></li>
  <li><a href="/notices/tender.pdf">Tender for supply of lab equipment</a></li>
  <li><a href="https://youtu.be/abc">Call for Proposal : Critical Emerging Technology (video)</a></li>
  <li><a href="/notices/results">Results of Call for Proposals 2025</a></li>
  <li><a href="/a">Short</a></li>
</ul></main>
</body></html>
"""

FELLOWSHIP_PAGE = """<html><body><main><h1>Young Scientist Fellowship</h1>
<p>The fellowship supports early-career researchers working in Indian institutions on any area of science.</p>
<p>Eligibility: Indian nationals below 35 years of age holding a PhD.</p>
<p>The last date for receipt of applications is 15 December 2026.</p></main></body></html>"""


class _Response:
    def __init__(self, text):
        self.text = text


def test_listing_keeps_calls_and_drops_jobs_tenders_results_videos_and_menus():
    calls = parse_listing(PAGE, ListingSource("TEST", "https://funder.example.in/"))
    assert [c["title"] for c in calls] == [
        "Call for Proposals under Inclusivity Research Grant 2026",
        "Applications invited for the Young Scientist Fellowship",
    ]
    irg = calls[0]
    assert irg["pdf_url"] == "https://funder.example.in/notices/irg.pdf"
    assert irg["deadline"] == "2026-11-30"  # stated next to the link


def test_listing_reads_call_pages_for_deadline_and_eligibility(monkeypatch):
    pages = {"https://funder.example.in/": PAGE, "https://funder.example.in/notices/fellowship": FELLOWSHIP_PAGE}
    monkeypatch.setattr(listing_adapter, "fetch", lambda url, **kw: _Response(pages[url]))
    monkeypatch.setattr(ListingAdapter, "check_robots_allowed", lambda self: True)
    calls = ListingAdapter(ListingSource("TEST", "https://funder.example.in/")).fetch_open_calls()
    fellowship = next(c for c in calls if "Fellowship" in c["title"])
    assert fellowship["deadline"] == "2026-12-15"
    assert fellowship["eligibility_clause"].startswith("Eligibility: Indian nationals below 35 years")


def test_undated_html_announcements_are_not_kept(monkeypatch):
    page = '<main><a href="/old">Call for Proposals under an old scheme</a></main>'
    pages = {"https://funder.example.in/": page, "https://funder.example.in/old": "<main>Nothing useful here.</main>"}
    monkeypatch.setattr(listing_adapter, "fetch", lambda url, **kw: _Response(pages[url]))
    monkeypatch.setattr(ListingAdapter, "check_robots_allowed", lambda self: True)
    assert ListingAdapter(ListingSource("TEST", "https://funder.example.in/")).fetch_open_calls() == []


def test_every_default_funder_has_an_adapter():
    assert set(config.AGENCY_LIST) <= set(AGENCY_REGISTRY)


def test_moes_internal_pdf_link_becomes_the_call_url(monkeypatch):
    news = {"posts": [{
        "post_title": "Call for Proposals: India–EU (Horizon Europe) Co-Funding Initiative",
        "post_slug": "india-eu", "post_date": "2026-09-28 10:00:00", "post_content": "",
        "acf_data": {"type": "Internal Link", "internal_link": "/static/uploads/2026/04/call.pdf"},
    }]}

    class _Json:
        def __init__(self, payload):
            self.payload = payload

        def json(self):
            return self.payload

    monkeypatch.setattr(gov_cms_adapter, "fetch", lambda url, **kw: _Json(news if "whats_new" in url else {"posts": []}))
    monkeypatch.setattr(MoESAdapter, "check_robots_allowed", lambda self: True)
    [call] = MoESAdapter().fetch_open_calls()
    assert call["url"] == call["pdf_url"] == "https://www.moes.gov.in/static/uploads/2026/04/call.pdf"


def test_new_default_funders_reach_users_who_kept_the_old_defaults():
    assert set(config.with_new_defaults(list(config.LEGACY_DEFAULT_SOURCES))) == set(config.DEFAULT_SOURCES)
    opted_out = ["ANRF", "DBT", "WikiCFP"]  # turned DST and others off
    assert config.with_new_defaults(opted_out) == opted_out


@pytest.mark.parametrize(("text", "expected"), [
    ("proposals should be submitted latest by 31st December, 2025. Indian", "2025-12-31"),
    ("the application must reach not later than 15.11.2026", "2026-11-15"),
    ("Applications close on 30 Nov 2026.", "2026-11-30"),
    ("The symposium will be held on 28th October 2026 in Delhi.", None),  # an event, not a deadline
])
def test_indian_deadline_phrasings(text, expected):
    assert latest_cued_deadline(text) == expected


def test_call_pdf_skips_sidebar_and_unrelated_pdfs():
    html = """<aside><a href="/chart.pdf">Organisational Chart</a></aside>
    <main><a href="/form.pdf">Application Form</a> <a href="/other.pdf">Guidelines for Professor of Practice</a>
    <a href="/history.pdf">Call for Research Proposal on History of Science 2026</a></main>"""
    assert call_pdf(html, "Call for Research Proposal on History of Science 2026") == "/history.pdf"
    assert call_pdf(html, "UGC Research Awards") is None
