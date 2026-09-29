"""Indian Council of Medical Research (ICMR) calls adapter.

icmr.gov.in/call-for-proposals has one table: S.No | Title | Last date | Link to apply | Document.
Result announcements ("Results: …") share the table; funding_deadline_scan drops them.
"""
from typing import Any
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from radar.sources.agency_scraper_base import AgencyAdapter
from radar.sources.http import fetch

BASE = "https://www.icmr.gov.in/"


def parse_icmr_calls(html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table")
    if table is None:
        raise ValueError("ICMR calls table not found (page layout changed?)")

    calls: list[dict[str, Any]] = []
    for row in table.find_all("tr"):
        cells = row.find_all(["td", "th"])
        if len(cells) < 3 or not cells[0].get_text(strip=True).isdigit():
            continue
        title = " ".join(cells[1].get_text(" ", strip=True).split())
        title = title.replace("\u0093", '"').replace("\u0094", '"').replace("“", '"').replace("”", '"')
        if len(title) <= 10:
            continue
        apply_link = cells[3].find("a", href=True) if len(cells) > 3 else None
        doc_link = cells[4].find("a", href=True) if len(cells) > 4 else None
        title_link = cells[1].find("a", href=True)
        link = apply_link or doc_link or title_link
        doc_url = urljoin(BASE, doc_link["href"]) if doc_link else None
        calls.append({
            "title": title,
            # No link: dropped downstream (a shared listing URL would merge different calls in dedup)
            "url": urljoin(BASE, link["href"]) if link else None,
            "pdf_url": doc_url if doc_url and doc_url.lower().split("?")[0].endswith(".pdf") else None,
            "deadline": cells[2].get_text(" ", strip=True) or None,
        })
    return calls


class ICMRAdapter(AgencyAdapter):
    agency_name = "ICMR"
    url = "https://www.icmr.gov.in/call-for-proposals"

    def _fetch_calls(self) -> list[dict[str, Any]]:
        return parse_icmr_calls(fetch(self.url).text)
