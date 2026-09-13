"""Example Indian funding agency HTML scraper adapter."""
from typing import Any

import requests
from bs4 import BeautifulSoup

from radar.sources.agency_scraper_base import AgencyAdapter


class ExampleIndianAgencyAdapter(AgencyAdapter):
    agency_name = "DST-SERB"
    url = "https://dst.gov.in/call-for-proposals"

    def fetch_open_calls(self) -> list[dict[str, Any]]:
        if not self.check_robots_allowed():
            return []

        try:
            res = requests.get(self.url, timeout=10, headers={"User-Agent": "ResearchOpportunityRadar/1.0"})
            if res.status_code != 200:
                return []
            soup = BeautifulSoup(res.text, "html.parser")
            calls = []
            for item in soup.find_all("a", href=True):
                title = item.get_text(strip=True)
                if title and len(title) > 15 and ("call" in title.lower() or "proposal" in title.lower() or "grant" in title.lower()):
                    calls.append({
                        "title": title,
                        "url": item["href"] if item["href"].startswith("http") else f"https://dst.gov.in{item['href']}",
                        "deadline": None
                    })
            return calls[:10]
        except Exception:
            return []
