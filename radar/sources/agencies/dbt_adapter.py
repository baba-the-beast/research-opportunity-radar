"""Department of Biotechnology (DBT) calls adapter.

dbt.gov.in/data-view?name=call-for-proposals returns JSON: a list of
{title, start_date (dd-mm-yyyy), end_date (dd-mm-yyyy), file_url (PDF)}.
"""
from typing import Any

from radar.sources.agency_scraper_base import AgencyAdapter
from radar.sources.http import fetch


def parse_dbt_calls(items: Any) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        raise ValueError("expected a JSON list of calls")
    calls: list[dict[str, Any]] = []
    for item in items:
        title = " ".join(str(item.get("title") or "").split())
        file_url = item.get("file_url")
        if len(title) <= 5 or not file_url:
            continue
        calls.append({
            "title": title,
            "url": file_url,
            "pdf_url": file_url if str(file_url).lower().endswith(".pdf") else None,
            "opens_on": item.get("start_date"),
            "deadline": item.get("end_date"),
        })
    return calls


class DBTAdapter(AgencyAdapter):
    agency_name = "DBT"
    url = "https://dbt.gov.in/data-view?name=call-for-proposals"

    def _fetch_calls(self) -> list[dict[str, Any]]:
        return parse_dbt_calls(fetch(self.url, headers={"Accept": "application/json"}).json())
