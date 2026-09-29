"""funding_deadline_scan tool for scanning funding agency calls."""
import logging

from radar.deadlines.deadline_engine import lifecycle_status, parse_deadline
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
                        # Grants.gov dates are US month-first (MM/DD/YYYY)
                        dl_date, conf = parse_deadline(close_date_str, day_first=False)
                        opp.deadlines.append(OpportunityDeadline(
                            deadline_type="full_proposal",
                            deadline_date=dl_date,
                            confidence=conf,
                            raw_text=close_date_str
                        ))
                    # openDate is when applications opened, not a deadline; it stays in metadata

                    if lifecycle_status(title, [d.deadline_date for d in opp.deadlines]) == "closed":
                        continue
                    opportunities.append(opp)
            except Exception as e:
                logger.error(f"Grants.gov scan failed: {e}")
        elif agency in AGENCY_REGISTRY:
            try:
                adapter_cls = AGENCY_REGISTRY[agency]
                adapter = adapter_cls()
                calls = adapter.fetch_open_calls()
                skipped = 0
                for call in calls:
                    title = (call.get("title") or "").strip()
                    url = call.get("url")
                    if not title or not url:
                        continue  # a call without a link can't be acted on, and would collide in dedup
                    raw_dl = call.get("deadline")
                    dl_date, conf = parse_deadline(raw_dl) if raw_dl else (None, "unknown")
                    status = lifecycle_status(title, [dl_date])
                    if status in ("result_notice", "closed"):
                        skipped += 1
                        continue
                    opp = Opportunity(
                        kind="funding",
                        title=title,
                        summary=call.get("summary") or f"Open call from {adapter.agency_name}",
                        agency_or_publisher=adapter.agency_name,
                        # "unknown" = no published deadline; shown as such rather than as a confirmed open call
                        status="open" if status == "open" else "unknown",
                        source_name=adapter.agency_name,
                        source_url=url,
                        metadata=call
                    )
                    opp.sources.append(OpportunitySource(
                        source_name=adapter.agency_name,
                        source_url=url
                    ))
                    if raw_dl:
                        opp.deadlines.append(OpportunityDeadline(
                            deadline_type="full_proposal",
                            deadline_date=dl_date,
                            confidence=conf,
                            raw_text=raw_dl
                        ))
                    opportunities.append(opp)
                if skipped:
                    logger.info(f"{adapter.agency_name}: skipped {skipped} closed calls and result notices")
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
