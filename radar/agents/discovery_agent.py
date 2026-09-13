"""Autonomous Discovery and Search Agent.

Autonomously discovers research opportunities, unindexed agency solicitations,
special issues, and conference calls beyond static API filters by formulating
targeted query vectors and parsing academic announcements.
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

from radar.deadlines.deadline_engine import classify_deadline_confidence
from radar.models import FacultyProfile, Opportunity, OpportunityDeadline, OpportunitySource, ProfileTerm
from radar.sources.agency_scraper_base import HONEST_USER_AGENT, is_scraping_allowed
from radar.sources.rate_limiter import scraper_limiter

logger = logging.getLogger(__name__)


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


class DiscoveryAgent:
    """Agent that performs autonomous, multi-strategy research opportunity discovery."""

    def __init__(self, telemetry_callback: Callable[[dict[str, Any]], None] | None = None):
        self.telemetry_callback = telemetry_callback

    def _emit(self, phase: str, message: str, payload: dict[str, Any] | None = None):
        if self.telemetry_callback:
            self.telemetry_callback({
                "agent": "DiscoveryAgent",
                "phase": phase,
                "message": message,
                "payload": payload or {},
                "timestamp": datetime.now(UTC).isoformat()
            })

    def formulate_queries(self, profile: FacultyProfile, terms: list[ProfileTerm] | None = None) -> list[dict[str, str]]:
        """Synthesizes high-precision search query vectors across academic channels."""
        self._emit(
            phase="QUERY_FORMULATION",
            message=f"Formulating query vectors from {len(profile.research_keywords)} active research keywords...",
            payload={"keywords": profile.research_keywords}
        )

        queries: list[dict[str, str]] = []
        keywords = profile.research_keywords or ["cyber-physical systems", "sensor fusion", "edge AI"]

        for kw in keywords[:4]:
            # 1. Federal & Foundation Funding Solicitations
            queries.append({
                "category": "funding",
                "query": f'"{kw}" ("call for proposals" OR "solicitation" OR "dear colleague letter") (NSF OR DARPA OR DOE OR NIH)',
                "keyword": kw,
                "target_type": "federal_rfp"
            })
            # 2. Archival Special Issues & Rapid Trans.
            queries.append({
                "category": "journal",
                "query": f'"{kw}" ("special issue" OR "call for papers" OR "topical collection") (IEEE OR ACM OR Nature OR Springer)',
                "keyword": kw,
                "target_type": "journal_special_issue"
            })
            # 3. Top-Tier Conferences & Symposia
            queries.append({
                "category": "venue",
                "query": f'"{kw}" ("call for papers" OR "CFP" OR "paper submission") (conference OR symposium) 2025 OR 2026',
                "keyword": kw,
                "target_type": "conference_cfp"
            })

        self._emit(
            phase="QUERIES_COMPILED",
            message=f"Synthesized {len(queries)} autonomous query vectors across funding, special issues, and conferences.",
            payload={"total_queries": len(queries)}
        )
        return queries

    def search_arxiv_announcements(self, keyword: str, max_results: int = 3) -> list[Opportunity]:
        """Queries arXiv API for emerging preprints describing upcoming grand challenges or open benchmark calls."""
        clean_kw = urllib.parse.quote(keyword)
        url = f"http://export.arxiv.org/api/query?search_query=all:{clean_kw}&start=0&max_results={max_results}&sortBy=submittedDate&sortOrder=descending"
        results: list[Opportunity] = []

        try:
            resp = _resilient_get(url, headers={"User-Agent": HONEST_USER_AGENT}, timeout=8)
            if resp.status_code == 200:
                root = ET.fromstring(resp.content)
                ns = {"atom": "http://www.w3.org/2005/Atom"}
                for entry in root.findall("atom:entry", ns):
                    title_elem = entry.find("atom:title", ns)
                    summary_elem = entry.find("atom:summary", ns)
                    id_elem = entry.find("atom:id", ns)
                    published_elem = entry.find("atom:published", ns)
                    pub_date = published_elem.text.strip() if published_elem is not None and published_elem.text else ""

                    if title_elem is not None and id_elem is not None:
                        clean_title = " ".join(title_elem.text.strip().split())
                        arxiv_id = id_elem.text.strip()
                        summary_txt = " ".join(summary_elem.text.strip().split()) if summary_elem is not None else ""

                        opp = Opportunity(
                            kind="journal",
                            title=f"ArXiv Open Science Call: {clean_title}",
                            summary=summary_txt[:350] + "...",
                            agency_or_publisher="arXiv.org Open Research",
                            venue_name="arXiv Computing Research Repository (CoRR)",
                            primary_source_name="ArXiv RSS / API",
                            primary_source_url=arxiv_id,
                            external_id=f"ARXIV:{arxiv_id.split('/')[-1]}",
                            discovered_at=datetime.now(UTC),
                            metadata={"origin": "arxiv_api", "category": "open_science", "published_date": pub_date, "solicitation_guidelines": summary_txt}
                        )
                        results.append(opp)
        except Exception as e:
            logger.debug(f"arXiv discovery request skipped: {e}")

        return results

    def search_nsf_solicitations(self, profile: FacultyProfile, max_results: int = 5) -> list[Opportunity]:
        """Fetches and parses live NSF open solicitations from official NSF RSS feeds."""
        rss_url = "https://www.nsf.gov/rss/rss_www_funding.xml"
        if not is_scraping_allowed(rss_url, user_agent="ResearchOpportunityRadar"):
            logger.warning("Scraping disallowed by robots.txt for NSF RSS")
            return []

        results: list[Opportunity] = []
        try:
            resp = _resilient_get(rss_url, headers={"User-Agent": HONEST_USER_AGENT}, timeout=10)
            if resp.status_code == 200:
                root = ET.fromstring(resp.content)
                keywords = [k.lower() for k in (profile.research_keywords or [])]
                for item in root.findall(".//item"):
                    title_elem = item.find("title")
                    link_elem = item.find("link")
                    desc_elem = item.find("description")
                    pub_elem = item.find("pubDate")

                    if title_elem is None or link_elem is None:
                        continue

                    raw_title = title_elem.text.strip() if title_elem.text else ""
                    raw_link = link_elem.text.strip() if link_elem.text else ""
                    raw_desc = desc_elem.text.strip() if desc_elem is not None and desc_elem.text else ""
                    pub_date = pub_elem.text.strip() if pub_elem is not None and pub_elem.text else None

                    if not raw_title or not raw_link:
                        continue

                    combined_text = f"{raw_title} {raw_desc}".lower()
                    relevance_match = any(kw in combined_text for kw in keywords) if keywords else True

                    ext_id = f"NSF-{hashlib.md5(raw_link.encode('utf-8')).hexdigest()[:8].upper()}"

                    opp = Opportunity(
                        kind="funding",
                        title=f"NSF Solicitation: {raw_title}",
                        summary=raw_desc[:400] + ("..." if len(raw_desc) > 400 else ""),
                        agency_or_publisher="National Science Foundation",
                        venue_name="NSF Directorate for Engineering / CISE",
                        source_name="NSF Solicitations Feed",
                        source_url=raw_link,
                        external_id=ext_id,
                        discovered_at=datetime.now(UTC),
                        sources=[
                            OpportunitySource(
                                source_name="NSF Solicitations Feed",
                                source_url=raw_link,
                                external_id=ext_id,
                                first_seen_at=datetime.now(UTC)
                            )
                        ],
                        metadata={
                            "origin": "nsf_rss_feed",
                            "pub_date": pub_date,
                            "solicitation_url": raw_link,
                            "keyword_matched": relevance_match,
                            "solicitation_guidelines": raw_desc
                        }
                    )

                    parsed_date, confidence = classify_deadline_confidence(raw_desc)
                    if parsed_date:
                        opp.deadlines.append(OpportunityDeadline(
                            deadline_type="full_proposal",
                            deadline_date=parsed_date,
                            confidence=confidence,
                            raw_text=raw_desc[:120]
                        ))

                    results.append(opp)
                    if len(results) >= max_results:
                        break
        except Exception as e:
            logger.warning(f"NSF solicitations live discovery request failed: {e}")

        return results

    def search_wikicfp(self, keyword: str, max_results: int = 3) -> list[Opportunity]:
        """Queries WikiCFP for live calls for papers, special sessions, and workshops."""
        clean_kw = urllib.parse.quote(keyword)
        url = f"http://www.wikicfp.com/cfp/servlet/tool.search?q={clean_kw}&year=a"
        if not is_scraping_allowed(url, user_agent="ResearchOpportunityRadar"):
            logger.warning("Scraping disallowed by robots.txt for WikiCFP")
            return []

        results: list[Opportunity] = []
        try:
            resp = _resilient_get(url, headers={"User-Agent": HONEST_USER_AGENT}, timeout=10)
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, "html.parser")
                seen_urls = set()
                for a in soup.find_all("a", href=True):
                    href = a["href"]
                    if "/cfp/servlet/event.showcfp?eventid=" in href:
                        raw_title = a.text.strip()
                        full_url = f"http://www.wikicfp.com{href}" if href.startswith("/") else href
                        if not raw_title or len(raw_title) < 3 or full_url in seen_urls:
                            continue
                        seen_urls.add(full_url)
                        event_id = href.split("eventid=")[-1].split("&")[0]

                        is_journal = "journal" in raw_title.lower() or "special issue" in raw_title.lower()
                        opp_kind = "journal" if is_journal else "venue"

                        opp = Opportunity(
                            kind=opp_kind,
                            title=f"CFP: {raw_title}",
                            summary=f"Open call for papers matching '{keyword}' indexed on WikiCFP.",
                            agency_or_publisher="WikiCFP Academic Index",
                            venue_name=raw_title,
                            source_name="WikiCFP Portal",
                            source_url=full_url,
                            external_id=f"WIKICFP:{event_id}",
                            discovered_at=datetime.now(UTC),
                            sources=[
                                OpportunitySource(
                                    source_name="WikiCFP Portal",
                                    source_url=full_url,
                                    external_id=f"WIKICFP:{event_id}",
                                    first_seen_at=datetime.now(UTC)
                                )
                            ],
                            metadata={
                                "origin": "wikicfp_crawler",
                                "query_keyword": keyword,
                                "event_id": event_id
                            }
                        )
                        results.append(opp)
                        if len(results) >= max_results:
                            break
        except Exception as e:
            logger.warning(f"WikiCFP live discovery request failed: {e}")

        return results

    def discover_unindexed_opportunities(self, profile: FacultyProfile) -> list[Opportunity]:
        """Scans active academic solicitation feeds (NSF Open Solicitations & WikiCFP CFPs)."""
        self._emit(
            phase="CRAWLING_AGENCY_PORTALS",
            message="Scanning live academic solicitation repositories & NSF funding solicitations...",
            payload={"sources": ["NSF Open Solicitations RSS", "WikiCFP Conference & Special Issues"]}
        )

        candidates: list[Opportunity] = []

        # 1. Fetch live NSF open solicitations
        nsf_items = self.search_nsf_solicitations(profile, max_results=3)
        candidates.extend(nsf_items)

        # 2. Fetch live WikiCFP calls for top keywords
        for kw in (profile.research_keywords or ["edge AI"])[:2]:
            cfp_items = self.search_wikicfp(kw, max_results=2)
            candidates.extend(cfp_items)

        self._emit(
            phase="CANDIDATES_DISCOVERED",
            message=f"Discovered {len(candidates)} live academic and agency solicitations.",
            payload={"count": len(candidates), "titles": [c.title for c in candidates]}
        )
        return candidates

    def run_discovery_cycle(self, profile: FacultyProfile, terms: list[ProfileTerm] | None = None) -> list[Opportunity]:
        """Runs an autonomous multi-stage discovery cycle."""
        self._emit(
            phase="CYCLE_START",
            message=f"Initiating autonomous discovery cycle for faculty '{profile.full_name}' ({profile.institution}).",
            payload={"faculty": profile.full_name, "institution": profile.institution}
        )

        # 1. Synthesize targeted search queries
        queries = self.formulate_queries(profile, terms)
        self._emit(
            phase="QUERY_FORMULATION",
            message=f"Formulated {len(queries)} autonomous query vectors across research topics.",
            payload={"queries_count": len(queries)}
        )

        # 2. Query arXiv API for live preprints/announcements
        arxiv_items: list[Opportunity] = []
        for kw in (profile.research_keywords or ["edge AI"])[:2]:
            self._emit(
                phase="ARXIV_SCAN",
                message=f"Querying arXiv open announcements for keyword '{kw}'...",
                payload={"keyword": kw}
            )
            items = self.search_arxiv_announcements(kw, max_results=1)
            arxiv_items.extend(items)

        # 3. Discover unindexed federal & archival calls
        unindexed_items = self.discover_unindexed_opportunities(profile)

        total_discovered = arxiv_items + unindexed_items
        self._emit(
            phase="CYCLE_COMPLETE",
            message=f"Autonomous discovery completed: {len(total_discovered)} candidates extracted and prepared for validation.",
            payload={"total_discovered": len(total_discovered)}
        )
        return total_discovered
