"""Department of Biotechnology (DBT India) funding calls adapter."""
import logging
import re
from typing import Any

import requests
from bs4 import BeautifulSoup
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from radar.sources.agency_scraper_base import AgencyAdapter
from radar.sources.rate_limiter import scraper_limiter

logger = logging.getLogger(__name__)

USER_AGENT = "ResearchOpportunityRadar/1.0 (+https://github.com/org/repo; contact: faculty@institution.edu)"


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=0.1, min=0.1, max=1.0),
    retry=retry_if_exception_type((requests.exceptions.ConnectionError, requests.exceptions.Timeout)),
    reraise=True
)
def _fetch_dbt_page(url: str) -> requests.Response:
    scraper_limiter.wait()
    try:
        return requests.get(url, timeout=20, headers={"User-Agent": USER_AGENT})
    except requests.exceptions.SSLError:
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        return requests.get(url, timeout=20, headers={"User-Agent": USER_AGENT}, verify=False)


class DBTAdapter(AgencyAdapter):
    agency_name = "DBT"
    url = "https://dbt.gov.in/data-view?name=call-for-proposals"

    def fetch_open_calls(self) -> list[dict[str, Any]]:
        if not self.check_robots_allowed():
            logger.warning(f"Scraping disallowed by robots.txt for {self.agency_name} at {self.url}")
            return []

        try:
            res = _fetch_dbt_page(self.url)
            if res.status_code != 200:
                logger.warning(f"DBT returned HTTP status {res.status_code}")
                return []

            calls: list[dict[str, Any]] = []

            # 1. Primary: Parse JSON returned by live Laravel data-view API
            try:
                json_data = res.json()
                if isinstance(json_data, list):
                    for item in json_data:
                        title = item.get("title", "").strip()
                        if title and len(title) > 5:
                            file_url = item.get("file_url") or f"https://dbt.gov.in/storage/{item.get('id', '')}"
                            deadline = item.get("end_date")
                            calls.append({
                                "title": title,
                                "url": file_url,
                                "deadline": deadline
                            })
                    if calls:
                        return calls[:25]
            except Exception:
                pass

            # 2. Secondary fallback: HTML table rows or anchor tags
            soup = BeautifulSoup(res.text, "html.parser")
            rows = soup.find_all("tr")
            for row in rows:
                link = row.find("a", href=True)
                if link:
                    title = link.get_text(strip=True)
                    if title and len(title) > 12:
                        href = link["href"]
                        full_url = href if href.startswith("http") else f"https://dbt.gov.in/{href.lstrip('/')}"
                        text = row.get_text(" ", strip=True)
                        date_match = re.search(r"(?:last\s+date|deadline|due\s+date)?[:\s]*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})", text, re.IGNORECASE)
                        raw_date = date_match.group(1) if date_match else None
                        calls.append({
                            "title": title,
                            "url": full_url,
                            "deadline": raw_date
                        })

            if not calls:
                for a in soup.find_all("a", href=True):
                    text = a.get_text(strip=True)
                    if text and len(text) > 15:
                        lower = text.lower()
                        if any(k in lower for k in ["call", "proposal", "grant", "biotechnology", "scheme"]):
                            href = a["href"]
                            full_url = href if href.startswith("http") else f"https://dbt.gov.in/{href.lstrip('/')}"
                            calls.append({
                                "title": text,
                                "url": full_url,
                                "deadline": None
                            })

            return calls[:25]
        except Exception as e:
            logger.error(f"DBT adapter exception: {e}")
            return []
