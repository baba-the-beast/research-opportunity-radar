"""Indian Council of Social Science Research (ICSSR) calls adapter.

The icssr.org homepage lists announcements as a heading link plus a publication date
(`span.headingtext`, `span.datestamp`). Research-proposal calls, fellowships and journal calls for
papers are kept; award results and declarations are dropped. Each call's page states the last date
(often followed by extensions), which is read from the page.
"""
import re
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from radar.deadlines.deadline_engine import today_ist
from radar.sources.agency_scraper_base import AgencyAdapter, latest_cued_deadline, page_text
from radar.sources.http import FetchError, fetch

BASE = "https://icssr.org/"
MAX_DETAIL_PAGES = 15
MAX_AGE_DAYS = 400  # older announcements are only kept when their page states a future deadline

CALL_TITLE = re.compile(
    r"(call for|invites?|inviting|applications? (?:are )?invited|research proposals?|fellowships?|"
    r"special issue|manuscripts|research article competition)",
    re.I,
)
NOT_A_CALL = re.compile(r"\b(announcement of the award|results?|declaration of|selected|shortlisted|merit list)\b", re.I)
JOURNAL_CALL = re.compile(r"(call for papers|manuscripts|special issue|research articles?)", re.I)


def _published(stamp: str | None) -> str | None:
    """'12 August, 2024' -> '2024-08-12'."""
    if not stamp:
        return None
    try:
        return datetime.strptime(stamp.replace(",", "").strip(), "%d %B %Y").date().isoformat()
    except ValueError:
        return None


def parse_icssr_announcements(html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    calls: list[dict[str, Any]] = []
    seen: set[str] = set()
    for heading in soup.select("span.headingtext"):
        link = heading.find_parent("a", href=True)
        if link is None:
            continue
        title = " ".join(heading.get_text(" ", strip=True).split())
        url = urljoin(BASE, link["href"])
        if url in seen or not CALL_TITLE.search(title) or NOT_A_CALL.search(title):
            continue
        seen.add(url)
        item = link.find_parent("li")
        stamp = item.select_one("span.datestamp") if item else None
        calls.append({
            "title": title,
            "url": url,
            "kind": "journal" if JOURNAL_CALL.search(title) else "funding",
            "published": _published(stamp.get_text(strip=True) if stamp else None),
            "deadline": None,
        })
    return calls


def parse_icssr_call_page(html: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    text = page_text(html)
    # Read from page prose, not a date column: "probable"
    details: dict[str, Any] = {"deadline": latest_cued_deadline(text), "deadline_confidence": "probable"}
    if text:
        details["summary"] = text[:800]
        details["solicitation_guidelines"] = text[:12000]
    pdf = next((a["href"] for a in soup.find_all("a", href=True) if a["href"].lower().split("?")[0].endswith(".pdf")), None)
    if pdf:
        details["pdf_url"] = urljoin(BASE, pdf)
    return details


class ICSSRAdapter(AgencyAdapter):
    agency_name = "ICSSR"
    url = "https://icssr.org/"

    def _fetch_calls(self) -> list[dict[str, Any]]:
        calls = parse_icssr_announcements(fetch(self.url).text)
        oldest = (today_ist() - timedelta(days=MAX_AGE_DAYS)).isoformat()
        kept: list[dict[str, Any]] = []
        for call in calls[:MAX_DETAIL_PAGES]:
            try:
                call.update({k: v for k, v in parse_icssr_call_page(fetch(call["url"]).text).items() if v})
            except FetchError:
                pass
            if not call["deadline"] and call["published"] and call["published"] < oldest:
                continue
            kept.append(call)
        return kept
