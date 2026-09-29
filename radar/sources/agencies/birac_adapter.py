"""Biotechnology Industry Research Assistance Council (BIRAC) calls adapter.

birac.nic.in/cfp.php has a "Current Calls for Proposal" table and a "Previous Calls" table with the
same columns: S.No | title (link to cfp_view.php, often cut short with "...") | "Opens on <date>" |
"Last Date of Submission <dd-Mon-yyyy>". Only current calls are read; each call's page gives the
full title and the "Introduction" / "Who can apply?" sections.
"""
import re
from typing import Any
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from radar.sources.agency_scraper_base import AgencyAdapter
from radar.sources.http import FetchError, fetch

BASE = "https://birac.nic.in/"
MAX_DETAIL_PAGES = 15


def _clean(text: str) -> str:
    return " ".join(text.split())


def parse_birac_table(table: Any) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []
    for row in table.find_all("tr"):
        cells = row.find_all("td")
        link = row.find("a", href=True)
        if len(cells) < 2 or not link:
            continue
        # Dates are <small> notes under the title: "Opens on 12th May 2026", "Last Date of Submission 15-Jul-2026"
        notes = [_clean(n.get_text(" ", strip=True)) for n in row.find_all(["small", "td"])]
        opens = next((re.sub(r"(?i)^opens on\s*", "", t) for t in notes if t.lower().startswith("opens on")), None)
        closes = next((re.sub(r"(?i)^last date of submission\s*", "", t) for t in notes if t.lower().startswith("last date")), None)
        calls.append({
            "title": _clean(link.get_text(" ", strip=True)),
            "url": urljoin(BASE, link["href"]),
            "opens_on": opens,
            "deadline": closes,
        })
    return calls


def current_calls_table(html: str) -> Any | None:
    soup = BeautifulSoup(html, "html.parser")
    for table in soup.find_all("table"):
        header = _clean(table.find("tr").get_text(" ", strip=True)) if table.find("tr") else ""
        if "current call" in header.lower():
            return table
    return None


def _section(soup: Any, heading_pattern: str) -> str | None:
    """Text between a heading matching the pattern and the next heading."""
    heading = soup.find(["h1", "h2", "h3", "h4", "h5"], string=re.compile(heading_pattern, re.I))
    if heading is None:
        return None
    parts = []
    for sibling in heading.find_all_next():
        if sibling.name in ("h1", "h2", "h3", "h4", "h5"):
            break
        if sibling.name in ("p", "li", "td"):
            parts.append(sibling.get_text(" ", strip=True))
    text = _clean(" ".join(parts))
    return text or None


def parse_birac_detail(html: str, listed_title: str) -> dict[str, Any]:
    """Full title, summary, eligibility and guideline PDF from a cfp_view.php page."""
    soup = BeautifulSoup(html, "html.parser")
    details: dict[str, Any] = {}
    prefix = _clean(listed_title).rstrip(". ").strip()[:40].lower()
    for heading in soup.find_all(["h1", "h2", "h3", "h4"]):
        text = _clean(heading.get_text(" ", strip=True))
        if prefix and text.lower().startswith(prefix):
            details["title"] = text.rstrip(" -")
            break
    intro = _section(soup, r"^\s*introduction")
    if intro:
        details["summary"] = intro[:800]
    who = _section(soup, r"who\s+can\s+apply")
    if who:
        details["eligibility_clause"] = who[:1500]
    guidelines = " ".join(filter(None, [intro, _section(soup, r"key features"), who, _section(soup, r"how to apply")]))
    if guidelines:
        details["solicitation_guidelines"] = guidelines[:12000]
    pdf = next((a["href"] for a in soup.find_all("a", href=True)
                if a["href"].lower().endswith(".pdf") and "code_of_conduct" not in a["href"].lower()), None)
    if pdf:
        details["pdf_url"] = urljoin(BASE, pdf)
    return details


class BIRACAdapter(AgencyAdapter):
    agency_name = "BIRAC"
    url = "https://birac.nic.in/cfp.php"

    def _fetch_calls(self) -> list[dict[str, Any]]:
        table = current_calls_table(fetch(self.url).text)
        if table is None:
            raise ValueError("BIRAC 'Current Calls' table not found (page layout changed?)")
        calls = parse_birac_table(table)
        for call in calls[:MAX_DETAIL_PAGES]:
            try:
                call.update(parse_birac_detail(fetch(call["url"]).text, call["title"]))
            except FetchError:
                pass  # the listing row is still usable
        return calls
