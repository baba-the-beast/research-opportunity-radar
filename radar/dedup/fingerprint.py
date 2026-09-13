"""Multi-stage fingerprint computation and matching module."""
import hashlib
import re

from rapidfuzz import fuzz

from radar.models import Opportunity


def normalize(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())

def is_award_record(opp: Opportunity) -> bool:
    """Checks if an opportunity represents historical awarded grant intelligence rather than an open call."""
    if opp.kind == "award":
        return True
    if opp.primary_source_name and "award" in opp.primary_source_name.lower():
        return True
    if opp.metadata and (
        opp.metadata.get("origin") == "nsf_awards_api"
        or opp.metadata.get("is_historical_award")
        or opp.metadata.get("award_id")
    ):
        return True
    return False

def compute_fingerprint(kind: str, title: str, agency_or_publisher: str | None, doi_or_external_id_or_url: str | None) -> str:
    key = f"{kind}|{normalize(title)}|{normalize(agency_or_publisher)}|{normalize(doi_or_external_id_or_url)}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()

def find_existing_match(candidate: Opportunity, existing: list[Opportunity]) -> Opportunity | None:
    """
    Runs the 5-stage matching order:
    1. Exact DOI match
    2. Exact official agency call/grant number (external_id + agency_or_publisher)
    3. Exact normalized official URL
    4. Exact normalized title + same source/funder
    5. Bounded fuzzy title match (rapidfuzz >= 92) + at least one overlapping signal (org/venue/deadline month)

    Crucial Guard: Never collapses historical award intelligence records (e.g. NSF Awards API)
    with active open application solicitations (e.g. Grants.gov), even if program titles match.
    """
    cand_doi = normalize(candidate.doi)
    cand_ext = normalize(candidate.external_id)
    cand_url = normalize(candidate.primary_source_url)
    cand_title = normalize(candidate.title)
    cand_agency = normalize(candidate.agency_or_publisher)
    cand_is_award = is_award_record(candidate)

    # Filter candidates by award instrument modality
    compatible_existing = [
        item for item in existing if is_award_record(item) == cand_is_award
    ]


    # Stage 1: Exact DOI
    if cand_doi:
        for item in compatible_existing:
            if item.doi and normalize(item.doi) == cand_doi:
                return item

    # Stage 2: External ID + Agency
    if cand_ext and cand_agency:
        for item in compatible_existing:
            if item.external_id and cand_agency == normalize(item.agency_or_publisher) and normalize(item.external_id) == cand_ext:
                return item

    # Stage 3: Normalized URL
    if cand_url:
        for item in compatible_existing:
            if item.primary_source_url and normalize(item.primary_source_url) == cand_url:
                return item

    # Stage 4: Exact normalized title + agency/publisher/source
    if cand_title:
        for item in compatible_existing:
            if normalize(item.title) == cand_title:
                if cand_agency and normalize(item.agency_or_publisher) == cand_agency:
                    return item
                if candidate.primary_source_name and item.primary_source_name and normalize(candidate.primary_source_name) == normalize(item.primary_source_name):
                    return item

    # Stage 5: Bounded fuzzy title match (>= 92) + overlapping signal
    if cand_title:
        cand_deadline_month = None
        cand_dl = candidate.earliest_confirmed_deadline()
        if cand_dl:
            cand_deadline_month = (cand_dl.year, cand_dl.month)

        for item in compatible_existing:
            item_title = normalize(item.title)
            ratio = fuzz.token_sort_ratio(cand_title, item_title)
            if ratio >= 92:
                # Check overlapping signal: org/venue matching or deadline month matching
                has_org_match = False
                if cand_agency and item.agency_or_publisher and normalize(item.agency_or_publisher) == cand_agency:
                    has_org_match = True
                if candidate.venue_name and item.venue_name and normalize(candidate.venue_name) == normalize(item.venue_name):
                    has_org_match = True

                item_dl = item.earliest_confirmed_deadline()
                item_deadline_month = (item_dl.year, item_dl.month) if item_dl else None
                has_deadline_match = (cand_deadline_month is not None and cand_deadline_month == item_deadline_month)

                if has_org_match or has_deadline_match:
                    return item

    return None
