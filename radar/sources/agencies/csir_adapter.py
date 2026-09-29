"""Council of Scientific & Industrial Research (CSIR) HRDG calls adapter.

csirhrdg.res.in/Home/Index lists announcements (What's New / Notices tabs: link + "YYYY-MM-DD"
publication date) and a scrolling banner of links. They mix research calls (e.g. "Advertisement for
Seeking Research Proposal under 'CSIR Emeritus Scientist Scheme'", "Special Call for Research Grants
for Women Scientists (ASPIRE)") with exam results, empanelments and circulars, so only call-like
titles are kept. The deadline is usually only in the linked PDF, which the pipeline reads for new
calls; linked HTML pages are read here.
"""
import re
from datetime import timedelta
from typing import Any
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from radar.deadlines.deadline_engine import today_ist
from radar.sources.agency_scraper_base import AgencyAdapter, latest_cued_deadline, page_text
from radar.sources.http import FetchError, fetch

BASE = "https://csirhrdg.res.in/"
MAX_AGE_DAYS = 240  # announcements older than this without a readable deadline are stale

CALL_TITLE = re.compile(
    r"(call for (?:research )?(?:proposals?|nominations?|applications?)|seeking research proposals?|"
    r"special call|research grants?|invit\w* (?:research )?proposals?|extramural research|emr scheme)",
    re.I,
)
NOT_A_CALL = re.compile(
    r"\b(results?|cut-?off|empanelment|translation reviewers?|income tax|tender|circular|office memorandum|"
    r"rationali[sz]ation|guidelines? (?:updat|revis)|suspended|net exam|answer key|admit card)\b",
    re.I,
)


def parse_csir_announcements(html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    items: list[tuple[Any, str | None]] = []
    for li in soup.select("#nav-tabContent li"):
        link = li.find("a", href=True)
        stamp = li.find(class_="date")
        if link:
            items.append((link, stamp.get_text(strip=True) if stamp else None))
    for link in soup.select("p.horizontalScrolling a[href]"):
        items.append((link, None))

    calls: list[dict[str, Any]] = []
    seen: set[str] = set()
    for link, published in items:
        title = " ".join(link.get_text(" ", strip=True).split())
        url = urljoin(BASE, link["href"])
        if not title or url in seen or not CALL_TITLE.search(title) or NOT_A_CALL.search(title):
            continue
        seen.add(url)
        calls.append({
            "title": title,
            "url": url,
            "pdf_url": url if url.lower().split("?")[0].endswith(".pdf") else None,
            "published": published,
            "deadline": None,
        })
    return calls


class CSIRAdapter(AgencyAdapter):
    agency_name = "CSIR"
    url = "https://csirhrdg.res.in/Home/Index"

    def _fetch_calls(self) -> list[dict[str, Any]]:
        calls = parse_csir_announcements(fetch(self.url).text)
        oldest = (today_ist() - timedelta(days=MAX_AGE_DAYS)).isoformat()
        kept: list[dict[str, Any]] = []
        for call in calls:
            if not call["pdf_url"]:
                # HTML call page (e.g. the ASPIRE portal): read its stated last date and summary
                try:
                    text = page_text(fetch(call["url"]).text)
                    call["deadline"] = latest_cued_deadline(text)
                    call["deadline_confidence"] = "probable"  # read from page prose
                    call["solicitation_guidelines"] = text[:12000]
                except FetchError:
                    pass
            if not call["deadline"] and call["published"] and call["published"] < oldest:
                continue  # an old announcement with no readable date is almost certainly closed
            kept.append(call)
        return kept
