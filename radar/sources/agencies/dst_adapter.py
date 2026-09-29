"""Department of Science & Technology (DST) calls adapter.

dst.gov.in/call-for-proposals is a Drupal view: a table with Title (link), Attachment (PDF),
Start Date and End Date (dd/mm/yyyy). When no call is open the view renders no table at all, which
is a normal empty result, not an error.
"""
from typing import Any
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from radar.sources.agency_scraper_base import AgencyAdapter
from radar.sources.http import fetch


def parse_dst_calls(html: str, base_url: str = "https://dst.gov.in/") -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    view = soup.select_one(".view-call-for-proposals") or soup.select_one("#content")
    table = view.find("table") if view else None
    if table is None:
        return []

    calls: list[dict[str, Any]] = []
    for row in table.select("tbody tr"):
        cells = row.find_all("td")
        link = cells[0].find("a", href=True) if cells else None
        if not link:
            continue
        title = link.get_text(" ", strip=True)
        pdf = cells[1].find("a", href=True) if len(cells) > 1 else None
        dates = [c.get_text(" ", strip=True) for c in cells[2:4]]
        calls.append({
            "title": title,
            "url": urljoin(base_url, link["href"]),
            "pdf_url": urljoin(base_url, pdf["href"]) if pdf else None,
            "opens_on": dates[0] if dates else None,
            "deadline": dates[1] if len(dates) > 1 and dates[1] else None,
        })
    return calls


class DSTAdapter(AgencyAdapter):
    agency_name = "DST"
    url = "https://dst.gov.in/call-for-proposals"

    def _fetch_calls(self) -> list[dict[str, Any]]:
        return parse_dst_calls(fetch(self.url).text)
