"""funding_deadline_scan tool for scanning funding agency calls."""
import logging

from radar.deadlines.deadline_engine import classify_deadline_confidence
from radar.dedup import fingerprint
from radar.models import Opportunity, OpportunityDeadline, OpportunitySource
from radar.sources import grants_gov_client
from radar.sources.agencies.dbt_adapter import DBTAdapter
from radar.sources.agencies.example_indian_agency import ExampleIndianAgencyAdapter
from radar.sources.agencies.icmr_adapter import ICMRAdapter
from radar.sources.agency_scraper_base import AgencyAdapter

logger = logging.getLogger(__name__)

AGENCY_REGISTRY: dict[str, type[AgencyAdapter]] = {
    "DST-SERB": ExampleIndianAgencyAdapter,
    "ICMR": ICMRAdapter,
    "DBT": DBTAdapter,
}

def funding_deadline_scan(agency_list: list[str]) -> list[Opportunity]:
    """
    Scans funding agencies for calls for proposals.
    """
    opportunities: list[Opportunity] = []

    for agency in agency_list:
        if agency.lower() in ("grants.gov", "grantsgov"):
            try:
                hits = grants_gov_client.search_opportunities(keyword="research", rows=25)
                for hit in hits:
                    title = hit.get("title") or "Funding Opportunity"
                    opp_id = hit.get("id") or hit.get("number")
                    agency_name = hit.get("agency") or "Grants.gov"
                    close_date_str = hit.get("closeDate")
                    open_date_str = hit.get("openDate")
                    url = f"https://www.grants.gov/search-results-detail/{opp_id}" if opp_id else "https://www.grants.gov"

                    metadata_payload = dict(hit)
                    if hit.get("description"):
                        metadata_payload["solicitation_guidelines"] = hit["description"]
                    if hit.get("applicantEligibilityDesc"):
                        metadata_payload["eligibility_clause"] = hit["applicantEligibilityDesc"]

                    opp = Opportunity(
                        kind="funding",
                        title=title,
                        summary=hit.get("description") or f"Grants.gov call by {agency_name}",
                        agency_or_publisher=agency_name,
                        status="open" if hit.get("oppStatus") == "posted" else "forecasted",
                        source_name="Grants.gov",
                        source_url=url,
                        external_id=str(opp_id),
                        metadata=metadata_payload
                    )
                    opp.sources.append(OpportunitySource(
                        source_name="Grants.gov",
                        source_url=url,
                        external_id=str(opp_id)
                    ))

                    if close_date_str:
                        dl_date, conf = classify_deadline_confidence(close_date_str)
                        opp.deadlines.append(OpportunityDeadline(
                            deadline_type="full_proposal",
                            deadline_date=dl_date,
                            confidence=conf,
                            raw_text=close_date_str
                        ))
                    if open_date_str:
                        dl_date, conf = classify_deadline_confidence(open_date_str)
                        opp.deadlines.append(OpportunityDeadline(
                            deadline_type="letter_of_intent",
                            deadline_date=dl_date,
                            confidence=conf,
                            raw_text=open_date_str
                        ))

                    opportunities.append(opp)
            except Exception as e:
                logger.error(f"Grants.gov scan failed: {e}")
        elif agency in AGENCY_REGISTRY:
            try:
                adapter_cls = AGENCY_REGISTRY[agency]
                adapter = adapter_cls()
                calls = adapter.fetch_open_calls()
                for call in calls:
                    title = call.get("title")
                    if not title:
                        continue
                    url = call.get("url") or "https://dst.gov.in"
                    raw_dl = call.get("deadline")
                    opp = Opportunity(
                        kind="funding",
                        title=title,
                        summary=f"Open call from {adapter.agency_name}",
                        agency_or_publisher=adapter.agency_name,
                        status="open",
                        source_name=adapter.agency_name,
                        source_url=url,
                        metadata=call
                    )
                    opp.sources.append(OpportunitySource(
                        source_name=adapter.agency_name,
                        source_url=url
                    ))
                    if raw_dl:
                        dl_date, conf = classify_deadline_confidence(raw_dl)
                        opp.deadlines.append(OpportunityDeadline(
                            deadline_type="full_proposal",
                            deadline_date=dl_date,
                            confidence=conf,
                            raw_text=raw_dl
                        ))
                    opportunities.append(opp)
            except Exception as e:
                logger.error(f"Agency adapter failed for '{agency}': {e}")
        else:
            logger.warning(f"Unknown funding agency name '{agency}' skipped.")

    # Deduplicate against each other
    deduped: list[Opportunity] = []
    for cand in opportunities:
        match = fingerprint.find_existing_match(cand, deduped)
        if not match:
            cand.fingerprint = fingerprint.compute_fingerprint(cand.kind, cand.title, cand.agency_or_publisher, cand.primary_source_url)
            deduped.append(cand)
        else:
            if cand.primary_source_name and cand.primary_source_url:
                match.sources.append(OpportunitySource(
                    source_name=cand.primary_source_name,
                    source_url=cand.primary_source_url,
                    external_id=cand.external_id
                ))
    return deduped
