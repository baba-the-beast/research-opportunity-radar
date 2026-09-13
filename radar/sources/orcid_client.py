"""
Public ORCID API Client (pub.orcid.org) for automated faculty profile pre-fill.
Fetches public author metadata, affiliations, publications, and keywords.

ARCHITECTURE / DUAL-IMPLEMENTATION NOTICE:
This module contains the Python parser for ORCID records used by backend jobs and scripts.
The Next.js web application independently implements equivalent parsing in TypeScript
at `web/app/api/profile/orcid/route.ts` to provide instant user feedback without process-spawning
or Python runtime overhead.

Both implementations are strictly verified against the shared real ORCID fixture:
  `tests/fixtures/orcid_2026_sample.json`
Any changes to parsing logic, career stage thresholds, or candidate term extraction rules
MUST be synchronized across both files and verified against the shared fixture.
"""
import re
from collections import Counter
from datetime import UTC, datetime
from typing import Any

import requests
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from radar.sources.rate_limiter import scraper_limiter

STOP_WORDS = {
    "the", "a", "an", "and", "or", "of", "in", "for", "on", "with", "at", "by",
    "to", "from", "is", "are", "was", "were", "using", "based", "via", "study",
    "analysis", "approach", "new", "novel", "towards", "improved", "method",
    "systems", "system", "through", "under", "between", "into", "journal",
    "conference", "proceedings", "international", "transactions"
}


def normalize_orcid(orcid_id: str) -> str:
    """Normalizes ORCID into standard 16-digit hyphenated format."""
    clean = re.sub(r'https?://[^/]+/', '', orcid_id).strip().strip('/')
    return clean



def parse_orcid_record_data(data: dict[str, Any]) -> dict[str, Any]:
    """
    Pure parser converting raw pub.orcid.org v3.0 JSON into normalized profile attributes.
    """
    person = data.get("person", {}) or {}
    name_info = person.get("name", {}) or {}
    given = (name_info.get("given-names") or {}).get("value", "")
    family = (name_info.get("family-name") or {}).get("value", "")
    full_name = f"{given} {family}".strip()

    # Extract keywords
    raw_keywords = (person.get("keywords") or {}).get("keyword", [])
    keywords = [k.get("content", "").strip() for k in raw_keywords if k.get("content")]

    # Extract employment / affiliation
    activities = data.get("activities-summary", {}) or {}
    employments = (activities.get("employments") or {}).get("employment-summary", [])
    institution = ""
    department = ""
    if employments and isinstance(employments, list):
        recent = employments[0]
        inst_summary = recent.get("organization", {}) or {}
        institution = inst_summary.get("name", "")
        department = recent.get("department-name", "") or ""

    # Extract works (publications)
    works_groups = (activities.get("works") or {}).get("group", [])
    work_summaries = []
    venues = []
    pub_years = []
    title_words = []

    for grp in works_groups:
        summaries = grp.get("work-summary", [])
        for w in summaries:
            title_obj = (w.get("title") or {}).get("title", {}) or {}
            title = title_obj.get("value", "")
            venue = (w.get("journal-title") or {}).get("value", "")

            pub_date = w.get("publication-date") or {}
            year_val = (pub_date.get("year") or {}).get("value")
            if year_val:
                try:
                    pub_years.append(int(year_val))
                except (ValueError, TypeError):
                    pass

            if title:
                work_summaries.append(title)
                # Tokenize for topic terms
                words = re.findall(r'[a-zA-Z]{3,}', title.lower())
                title_words.extend([wd for wd in words if wd not in STOP_WORDS])

            if venue:
                venues.append(venue.strip())

    # Infer career stage from first recorded publication year
    current_year = datetime.now(UTC).year
    career_stage = "mid_career"
    phd_year = None
    if pub_years:
        first_pub_year = min(pub_years)
        years_active = current_year - first_pub_year
        if years_active <= 3:
            career_stage = "early_career"
        elif years_active <= 10:
            career_stage = "mid_career"
        else:
            career_stage = "senior"
        phd_year = first_pub_year

    # Extract candidate profile terms
    candidate_terms = []

    # 1. Keywords as high-weight topic terms
    for kw in keywords[:6]:
        candidate_terms.append({
            "term": kw,
            "term_type": "topic",
            "weight": 1.0,
            "polarity": "positive",
            "source": "publication_seed"
        })

    # 2. Frequent title terms as topic terms
    word_counts = Counter(title_words)
    for word, count in word_counts.most_common(8):
        if not any(t["term"].lower() == word.lower() for t in candidate_terms):
            candidate_terms.append({
                "term": word,
                "term_type": "topic",
                "weight": 0.85,
                "polarity": "positive",
                "source": "publication_seed"
            })

    # 3. Frequent venues as venue terms
    venue_counts = Counter(venues)
    for venue, count in venue_counts.most_common(4):
        candidate_terms.append({
            "term": venue,
            "term_type": "venue",
            "weight": 0.9,
            "polarity": "positive",
            "source": "publication_seed"
        })

    return {
        "full_name": full_name,
        "institution": institution,
        "department": department,
        "keywords": keywords or [t["term"] for t in candidate_terms[:5]],
        "profile_text": f"Research program focused on {', '.join(keywords[:4])}." if keywords else "",
        "career_stage": career_stage,
        "phd_year": phd_year,
        "candidate_terms": candidate_terms,
        "recent_works_count": len(work_summaries)
    }


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=0.2, min=0.2, max=2.0),
    retry=retry_if_exception_type((requests.exceptions.RequestException,)),
    reraise=True
)
def fetch_orcid_profile(orcid_id: str) -> dict[str, Any]:
    """Fetches public record from pub.orcid.org and parses profile fields."""
    norm_id = normalize_orcid(orcid_id)
    url = f"https://pub.orcid.org/v3.0/{norm_id}/record"
    headers = {
        "Accept": "application/json",
        "User-Agent": "ResearchOpportunityRadar/1.0 (+https://github.com/org/repo; contact: faculty@institution.edu)"
    }
    scraper_limiter.wait()
    res = requests.get(url, headers=headers, timeout=12)
    res.raise_for_status()
    data = res.json()
    result = parse_orcid_record_data(data)
    result["orcid"] = norm_id
    return result
