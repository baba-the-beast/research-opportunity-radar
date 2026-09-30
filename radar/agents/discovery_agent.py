"""Discovery agent: calls for papers (conferences, workshops, journal special issues) matching each
research keyword, plus NSF solicitations when US sources are enabled.

Only items with a future submission deadline are returned: an undated or past CFP is not something a
faculty member can act on.
"""
import hashlib
import logging
import urllib.parse
import xml.etree.ElementTree as ET
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import requests
from bs4 import BeautifulSoup
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from radar import config
from radar.deadlines.deadline_engine import lifecycle_status, parse_deadline
from radar.models import FacultyProfile, Opportunity, OpportunityDeadline, OpportunitySource, ProfileTerm
from radar.sources.agency_scraper_base import HONEST_USER_AGENT, is_scraping_allowed
from radar.sources.http import is_http_url
from radar.sources.rate_limiter import scraper_limiter

logger = logging.getLogger(__name__)

# Same cap as the pipeline's per-run keyword window (MAX_SCAN_KEYWORDS), which already rotates
# across users; a smaller cap here would drop every keyword past the first few users.
MAX_CFP_KEYWORDS = 30
CFPS_PER_KEYWORD = 5
WIKICFP_BASE = "http://www.wikicfp.com"
US_SOURCE_NAMES = {"grants.gov", "grantsgov", "nsf"}


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=0.2, min=0.2, max=2.0),
    retry=retry_if_exception_type((requests.exceptions.RequestException,)),
    reraise=True
)
def _resilient_get(url: str, headers: dict[str, str] | None = None, timeout: int = 10) -> requests.Response:
    """Executes rate-limited HTTP GET with exponential backoff on network failures."""
    scraper_limiter.wait()
    resp = requests.get(url, headers=headers, timeout=timeout)
    resp.raise_for_status()
    return resp


def us_sources_enabled(agency_list: list[str] | None = None) -> bool:
    return any(a.lower() in US_SOURCE_NAMES for a in (agency_list if agency_list is not None else config.AGENCY_LIST))


def parse_wikicfp_results(html: str) -> list[dict[str, str]]:
    """Events from a WikiCFP search page. Each event is two table rows:
    [acronym link | full name] then [when | where | deadline ("Jan 30, 2026 (Jan 23, 2026)")]."""
    soup = BeautifulSoup(html, "html.parser")
    events: list[dict[str, str]] = []
    seen: set[str] = set()
    for link in soup.find_all("a", href=True):
        href = link["href"]
        if "event.showcfp?eventid=" not in href:
            continue
        event_id = href.split("eventid=")[-1].split("&")[0]
        if event_id in seen:
            continue
        row = link.find_parent("tr")
        if row is None:
            continue
        name_cells = [td for td in row.find_all("td") if link not in td.descendants]
        details_row = row.find_next_sibling("tr")
        details = [td.get_text(" ", strip=True) for td in details_row.find_all("td")] if details_row else []
        seen.add(event_id)
        events.append({
            "event_id": event_id,
            "acronym": link.get_text(" ", strip=True),
            "name": name_cells[0].get_text(" ", strip=True) if name_cells else "",
            "when": details[0] if len(details) > 0 else "",
            "where": details[1] if len(details) > 1 else "",
            # "Jan 30, 2026 (Jan 23, 2026)": paper deadline, then abstract deadline in brackets
            "deadline": details[2].split("(")[0].strip() if len(details) > 2 else "",
            "abstract_deadline": details[2].split("(")[1].rstrip(") ") if len(details) > 2 and "(" in details[2] else "",
            "url": urllib.parse.urljoin(WIKICFP_BASE, href),
        })
    return events


class DiscoveryAgent:
    """Finds calls for papers per research keyword (and NSF solicitations for US-enabled runs)."""

    def __init__(self, telemetry_callback: Callable[[dict[str, Any]], None] | None = None):
        self.telemetry_callback = telemetry_callback
        self.errors: list[dict[str, str]] = []

    def _emit(self, phase: str, message: str, payload: dict[str, Any] | None = None):
        if self.telemetry_callback:
            self.telemetry_callback({
                "agent": "DiscoveryAgent",
                "phase": phase,
                "message": message,
                "payload": payload or {},
                "timestamp": datetime.now(UTC).isoformat()
            })

    def search_nsf_solicitations(self, profile: FacultyProfile, max_results: int = 5) -> list[Opportunity]:
        """Live NSF solicitations from the NSF funding RSS feed that mention a profile keyword."""
        rss_url = "https://www.nsf.gov/rss/rss_www_funding.xml"
        if not is_scraping_allowed(rss_url, user_agent="ResearchOpportunityRadar"):
            logger.warning("Scraping disallowed by robots.txt for NSF RSS")
            return []

        keywords = [k.lower() for k in (profile.research_keywords or [])]
        results: list[Opportunity] = []
        try:
            resp = _resilient_get(rss_url, headers={"User-Agent": HONEST_USER_AGENT}, timeout=10)
            root = ET.fromstring(resp.content)
        except Exception as e:
            self.errors.append({"source": "NSF", "error": e.__class__.__name__})
            logger.warning(f"NSF solicitations request failed: {e}")
            return []

        for item in root.findall(".//item"):
            title_elem, link_elem = item.find("title"), item.find("link")
            desc_elem, pub_elem = item.find("description"), item.find("pubDate")
            raw_title = (title_elem.text or "").strip() if title_elem is not None else ""
            raw_link = (link_elem.text or "").strip() if link_elem is not None else ""
            raw_desc = (desc_elem.text or "").strip() if desc_elem is not None else ""
            if not raw_title or not is_http_url(raw_link):
                continue
            combined_text = f"{raw_title} {raw_desc}".lower()
            if keywords and not any(kw in combined_text for kw in keywords):
                continue

            ext_id = f"NSF-{hashlib.md5(raw_link.encode('utf-8')).hexdigest()[:8].upper()}"
            opp = Opportunity(
                kind="funding",
                title=f"NSF Solicitation: {raw_title}",
                summary=raw_desc[:400] + ("..." if len(raw_desc) > 400 else ""),
                agency_or_publisher="National Science Foundation",
                status="open",
                source_name="NSF Solicitations Feed",
                source_url=raw_link,
                external_id=ext_id,
                discovered_at=datetime.now(UTC),
                sources=[OpportunitySource(source_name="NSF Solicitations Feed", source_url=raw_link, external_id=ext_id)],
                metadata={
                    "origin": "nsf_rss_feed",
                    "pub_date": (pub_elem.text or "").strip() if pub_elem is not None else None,
                    "solicitation_guidelines": raw_desc,
                    "us_source": True,
                },
            )
            parsed_date, confidence = parse_deadline(raw_desc, day_first=False)  # NSF: US dates
            if parsed_date:
                if lifecycle_status(raw_title, [parsed_date]) == "closed":
                    continue
                opp.deadlines.append(OpportunityDeadline(
                    deadline_type="full_proposal", deadline_date=parsed_date, confidence=confidence, raw_text=raw_desc[:120]
                ))
            results.append(opp)
            if len(results) >= max_results:
                break
        return results

    def search_wikicfp(self, keyword: str, max_results: int = CFPS_PER_KEYWORD) -> list[Opportunity]:
        """Open calls for papers on WikiCFP matching `keyword`, with a future submission deadline."""
        url = f"{WIKICFP_BASE}/cfp/servlet/tool.search?q={urllib.parse.quote_plus(keyword)}&year=a"
        if not is_scraping_allowed(url, user_agent="ResearchOpportunityRadar"):
            logger.warning("Scraping disallowed by robots.txt for WikiCFP")
            return []
        try:
            resp = _resilient_get(url, headers={"User-Agent": HONEST_USER_AGENT}, timeout=10)
        except Exception as e:
            self.errors.append({"source": "WikiCFP", "error": e.__class__.__name__})
            logger.warning(f"WikiCFP request failed: {e.__class__.__name__}")
            return []

        results: list[Opportunity] = []
        for event in parse_wikicfp_results(resp.text):
            deadline, confidence = parse_deadline(event["deadline"], day_first=False)  # "Jan 30, 2026"
            if not deadline or lifecycle_status(event["acronym"], [deadline]) != "open":
                continue
            name = event["name"] or event["acronym"]
            is_journal = any(w in name.lower() for w in ("journal", "special issue", "transactions"))
            details = "; ".join(part for part in (
                f"When: {event['when']}" if event["when"] and event["when"].upper() != "N/A" else "",
                f"Where: {event['where']}" if event["where"] and event["where"].upper() != "N/A" else "",
                f"Abstract due {event['abstract_deadline']}" if event["abstract_deadline"] else "",
            ) if part)
            ext_id = f"WIKICFP:{event['event_id']}"
            opp = Opportunity(
                kind="journal" if is_journal else "venue",
                title=f"CFP: {event['acronym']}" + (f" — {event['name']}" if event["name"] else ""),
                summary=f"Call for papers: {name}." + (f" {details}." if details else ""),
                agency_or_publisher=None,
                venue_name=name,
                status="open",
                source_name="WikiCFP",
                source_url=event["url"],
                external_id=ext_id,
                discovered_at=datetime.now(UTC),
                sources=[OpportunitySource(source_name="WikiCFP", source_url=event["url"], external_id=ext_id)],
                metadata={"origin": "wikicfp", "event_id": event["event_id"], "when": event["when"], "where": event["where"]},
            )
            opp.deadlines.append(OpportunityDeadline(
                deadline_type="special_issue" if is_journal else "submission",
                deadline_date=deadline,
                confidence=confidence,
                raw_text=event["deadline"],
            ))
            results.append(opp)
            if len(results) >= max_results:
                break
        return results

    def run_discovery_cycle(
        self,
        profile: FacultyProfile,
        terms: list[ProfileTerm] | None = None,
        sources: set[str] | None = None,
    ) -> list[Opportunity]:
        """CFPs for each research keyword (capped), plus NSF solicitations when US sources are on.
        `sources` limits which of WikiCFP / NSF run (default: WikiCFP, and NSF if US sources are enabled)."""
        include_wikicfp = sources is None or "WikiCFP" in sources
        include_nsf = ("NSF" in sources) if sources is not None else us_sources_enabled()
        keywords = [k for k in (profile.research_keywords or []) if k.strip()][:MAX_CFP_KEYWORDS]
        self._emit("CYCLE_START", f"Searching calls for papers for {len(keywords)} research keywords.",
                   {"keywords_count": len(keywords)})

        found: list[Opportunity] = []
        seen_ids: set[str] = set()
        for kw in keywords if include_wikicfp else []:
            for opp in self.search_wikicfp(kw):
                if opp.external_id not in seen_ids:
                    seen_ids.add(opp.external_id or "")
                    found.append(opp)

        if include_nsf:
            found.extend(self.search_nsf_solicitations(profile))

        self._emit("CYCLE_COMPLETE", f"Found {len(found)} open calls for papers and solicitations.",
                   {"total_discovered": len(found)})
        return found
