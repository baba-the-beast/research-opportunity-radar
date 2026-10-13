"""Calls from an ordinary announcements page, configured per funder instead of coded per funder.

Most Indian funder websites have a page listing announcements as links: some are calls ("Call for
Proposals under ...", "Applications invited for ... Fellowship"), most are not (tenders, results,
jobs, circulars). A ``ListingSource`` names the page and, if needed, the part of it to read and
extra words that mark a call or a non-call. The adapter keeps call-like links, reads each linked
HTML page for its stated last date and eligibility, and leaves PDFs to the pipeline's PDF reader.

A call is kept only when a deadline was found or a PDF can supply one: an undated link on a news
page is more often an old announcement than an open call.
"""
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from radar.sources.agency_scraper_base import AgencyAdapter, eligibility_excerpt, latest_cued_deadline, page_text
from radar.sources.http import FetchError, fetch

CALL_TITLE = re.compile(
    r"(call for (?:r&d |research |joint |collaborative )?(?:proposals?|applications?|nominations?|pre-proposals?)|"
    r"proposals? (?:are )?invited|invit\w* (?:\w+ ){0,5}(?:proposals?|applications?|nominations?)|"
    r"applications? (?:are )?invited|fellowships?|research (?:grants?|awards?|scheme)|"
    r"letter of intent|expression of interest for (?:research|r&d|joint))",
    re.I,
)
NOT_A_CALL = re.compile(
    r"\b(tenders?|bids?|quotations?|results?|selected|shortlisted|merit list|answer key|admit card|"
    r"recruitment|vacanc\w*|posts? of|deputation|walk-?in|interview|corrigendum|addendum|minutes|"
    r"circular|office memorandum|empanelment|annual report|rti|award(?:ees|ed) list|"
    r"guidelines? (?:revised|updated)|faq|engagement of|apprentices?|retired|admissions?|"
    r"deemed to be university|autonomous status|conferment|position of|registration link)\b",
    re.I,
)


# Announcements often link a promo video or post; those are never the call itself
SOCIAL_HOSTS = {"youtube.com", "youtu.be", "m.youtube.com", "facebook.com", "twitter.com", "x.com",
                "instagram.com", "linkedin.com", "t.me"}


@dataclass
class ListingSource:
    name: str
    url: str
    scope: str | None = None          # CSS selector for the part of the page that lists announcements
    include: list[str] = field(default_factory=list)  # extra call words for this funder (regexes)
    exclude: list[str] = field(default_factory=list)  # extra non-call words (regexes)
    max_detail_pages: int = 12
    same_site_only: bool = False      # only follow links on the funder's own domain


def _clean(text: str) -> str:
    return " ".join((text or "").split())


def parse_listing(html: str, source: ListingSource) -> list[dict[str, Any]]:
    """Call-like links on a listing page, with any date stated next to them."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "header", "footer", "noscript"]):
        tag.decompose()
    roots = soup.select(source.scope) if source.scope else [soup.find("main") or soup.body or soup]
    include = [re.compile(p, re.I) for p in source.include]
    exclude = [re.compile(p, re.I) for p in source.exclude]
    home = urlparse(source.url).netloc.removeprefix("www.")

    calls: list[dict[str, Any]] = []
    seen: set[str] = set()
    for root in roots:
        for link in root.find_all("a", href=True):
            href = link["href"].strip()
            if href.startswith(("#", "mailto:", "javascript:", "tel:")):
                continue
            url = urljoin(source.url, href)
            title = _clean(link.get_text(" ", strip=True)) or _clean(link.get("title", ""))
            if len(title) < 15 or url in seen:
                continue
            is_call = CALL_TITLE.search(title) or any(p.search(title) for p in include)
            if not is_call or NOT_A_CALL.search(title) or any(p.search(title) for p in exclude):
                continue
            host = urlparse(url).netloc.lower().removeprefix("www.")
            if host in SOCIAL_HOSTS or (source.same_site_only and host != home):
                continue
            seen.add(url)
            row = link.find_parent(["li", "tr", "p", "div"])
            calls.append({
                "title": title,
                "url": url,
                "pdf_url": url if urlparse(url).path.lower().endswith(".pdf") else None,
                "deadline": latest_cued_deadline(_clean(row.get_text(" ", strip=True))) if row else None,
                "deadline_confidence": "probable",
            })
    return calls


def parse_call_page(html: str, base_url: str) -> dict[str, Any]:
    """Deadline, summary, eligibility and attached PDF from a call's own page."""
    text = page_text(html)
    details: dict[str, Any] = {}
    if len(text.split()) < 30:
        return details
    details["deadline"] = latest_cued_deadline(text)
    details["summary"] = text[:800]
    details["solicitation_guidelines"] = text[:12000]
    eligibility = eligibility_excerpt(text)
    if eligibility:
        details["eligibility_clause"] = eligibility
    soup = BeautifulSoup(html, "html.parser")
    pdf = next((a["href"] for a in soup.find_all("a", href=True) if urlparse(a["href"]).path.lower().endswith(".pdf")), None)
    if pdf:
        details["pdf_url"] = urljoin(base_url, pdf)
    return details


class ListingAdapter(AgencyAdapter):
    def __init__(self, source: ListingSource):
        super().__init__()
        self.source = source
        self.agency_name = source.name
        self.url = source.url

    def _fetch_calls(self) -> list[dict[str, Any]]:
        calls = parse_listing(fetch(self.url).text, self.source)
        kept: list[dict[str, Any]] = []
        detail_pages = 0
        for call in calls:
            if not call["pdf_url"] and detail_pages < self.source.max_detail_pages:
                detail_pages += 1
                try:
                    details = parse_call_page(fetch(call["url"]).text, call["url"])
                    call.update({k: v for k, v in details.items() if v and (k != "deadline" or not call["deadline"])})
                except FetchError:
                    pass
            if call["deadline"] or call["pdf_url"]:
                kept.append(call)
        return kept
