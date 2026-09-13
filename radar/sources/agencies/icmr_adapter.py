"""Indian Council of Medical Research (ICMR) funding calls adapter."""
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
def _fetch_icmr_page(url: str) -> requests.Response:
    scraper_limiter.wait()
    try:
        return requests.get(url, timeout=20, headers={"User-Agent": USER_AGENT})
    except requests.exceptions.SSLError:
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        return requests.get(url, timeout=20, headers={"User-Agent": USER_AGENT}, verify=False)


class ICMRAdapter(AgencyAdapter):
    agency_name = "ICMR"
    url = "https://www.icmr.gov.in/call-for-proposals"

    def fetch_open_calls(self) -> list[dict[str, Any]]:
        if not self.check_robots_allowed():
            logger.warning(f"Scraping disallowed by robots.txt for {self.agency_name} at {self.url}")
            return []

        try:
            res = _fetch_icmr_page(self.url)
            if res.status_code != 200:
                logger.warning(f"ICMR returned HTTP status {res.status_code}")
                return []

            soup = BeautifulSoup(res.text, "html.parser")
            calls: list[dict[str, Any]] = []

            # 1. Parse official proposals table
            table = soup.find("table")
            if table:
                for row in table.find_all("tr"):
                    cells = row.find_all(["td", "th"])
                    if len(cells) >= 5 and cells[0].get_text(strip=True).isdigit():
                        title = cells[1].get_text(" ", strip=True)
                        title = title.replace("\u0093", '"').replace("\u0094", '"').replace("“", '"').replace("”", '"')
                        raw_date = cells[2].get_text(strip=True) or None

                        # Link priority: Link to Apply (cells[3]) -> Document (cells[4]) -> Base URL
                        link_elem = cells[3].find("a", href=True) or cells[4].find("a", href=True)
                        full_url = self.url
                        if link_elem:
                            href = link_elem["href"]
                            full_url = href if href.startswith("http") else f"https://www.icmr.gov.in/{href.lstrip('/')}"

                        if title and len(title) > 10:
                            calls.append({
                                "title": title,
                                "url": full_url,
                                "deadline": raw_date
                            })

            # 2. Fallback to general table rows or anchor tags
            if not calls:
                table_rows = soup.find_all("tr")
                for row in table_rows:
                    cells = row.find_all(["td", "th"])
                    if len(cells) >= 2:
                        link = row.find("a", href=True)
                        if link:
                            title = link.get_text(strip=True)
                            if title and len(title) > 12:
                                href = link["href"]
                                full_url = href if href.startswith("http") else f"https://www.icmr.gov.in/{href.lstrip('/')}"
                                raw_date = None
                                for c in cells:
                                    text = c.get_text(strip=True)
                                    date_match = re.search(r"(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})", text, re.IGNORECASE)
                                    if date_match and text != title:
                                        raw_date = date_match.group(1)
                                        break
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
                        if any(k in lower for k in ["call", "proposal", "grant", "fellowship", "ad-hoc", "extramural"]):
                            href = a["href"]
                            full_url = href if href.startswith("http") else f"https://www.icmr.gov.in/{href.lstrip('/')}"
                            calls.append({
                                "title": text,
                                "url": full_url,
                                "deadline": None
                            })

            return calls[:25]
        except Exception as e:
            logger.error(f"ICMR adapter exception: {e}")
            return []

