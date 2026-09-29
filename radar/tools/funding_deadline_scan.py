"""funding_deadline_scan tool for scanning funding agency calls."""
import logging
import re

from radar.deadlines.deadline_engine import lifecycle_status, parse_deadline, today_ist
from radar.dedup import fingerprint
from radar.models import Opportunity, OpportunityDeadline, OpportunitySource
from radar.sources import grants_gov_client
from radar.sources.agencies.anrf_adapter import ANRFAdapter
from radar.sources.agencies.birac_adapter import BIRACAdapter
from radar.sources.agencies.csir_adapter import CSIRAdapter
from radar.sources.agencies.dbt_adapter import DBTAdapter
from radar.sources.agencies.dst_adapter import DSTAdapter
from radar.sources.agencies.icmr_adapter import ICMRAdapter
from radar.sources.agencies.icssr_adapter import ICSSRAdapter
from radar.sources.agency_scraper_base import AgencyAdapter

logger = logging.getLogger(__name__)

AGENCY_REGISTRY: dict[str, type[AgencyAdapter]] = {
    "ANRF": ANRFAdapter,
    "DST": DSTAdapter,
    "DBT": DBTAdapter,
    "ICMR": ICMRAdapter,
    "BIRAC": BIRACAdapter,
    "CSIR": CSIRAdapter,
    "ICSSR": ICSSRAdapter,
}
# SERB became part of ANRF in 2024; keep old configuration working
AGENCY_ALIASES = {"DST-SERB": "ANRF", "SERB": "ANRF"}

def _only_past_years(title: str) -> bool:
    """True when the title names years and all of them are before this year ("... Fellowship 2025").
    A range like "2026-27" counts as its later year."""
    years = [int(y) for y in re.findall(r"\b(20\d\d)\b", title)]
    years += [2000 + int(y) for y in re.findall(r"\b20\d\d\s*[-–/]\s*(\d\d)\b", title)]
    return bool(years) and max(years) < today_ist().year


def _call_to_opportunity(call: dict, agency_name: str) -> tuple[Opportunity | None, str]:
    """Build an Opportunity from an adapter's call dict. Returns (None, reason) for calls to skip."""
    title = " ".join(str(call.get("title") or "").split())
    url = call.get("url")
    if not title or not url:
        return None, "no_link"  # a call without a link can't be acted on, and would collide in dedup
    raw_dl = call.get("deadline")
    dl_date, conf = parse_deadline(raw_dl) if raw_dl else (None, "unknown")
    if dl_date and call.get("deadline_confidence") in ("confirmed", "probable"):
        conf = call["deadline_confidence"]  # e.g. "probable" for a date read from page prose
    lifecycle = lifecycle_status(title, [dl_date])
    if lifecycle == "unknown" and not call.get("rolling") and _only_past_years(title):
        lifecycle = "closed"  # "Call for Nomination ... Fellowship 2025" with no readable date: an old round
    if lifecycle in ("result_notice", "closed"):
        return None, lifecycle

    opens_on, _ = parse_deadline(call.get("opens_on")) if call.get("opens_on") else (None, "unknown")
    if call.get("rolling"):
        status = "open"  # accepts proposals all year
    elif lifecycle == "open":
        status = "forecasted" if opens_on and opens_on > today_ist() else "open"
    else:
        status = "unknown"  # no published deadline: shown as such, never as a confirmed open call

    metadata = {k: v for k, v in call.items() if v is not None}
    if opens_on:
        metadata["opens_on"] = opens_on.isoformat()
    kind = call.get("kind") if call.get("kind") in ("funding", "journal", "venue") else "funding"
    opp = Opportunity(
        kind=kind,
        title=title,
        summary=call.get("summary") or (f"Call for proposals from {agency_name}" if kind == "funding" else f"Call for papers from {agency_name}"),
        agency_or_publisher=agency_name,
        status=status,
        source_name=agency_name,
        source_url=url,
        metadata=metadata,
    )
    opp.sources.append(OpportunitySource(source_name=agency_name, source_url=url))
    if dl_date:
        opp.deadlines.append(OpportunityDeadline(
            deadline_type="full_proposal" if kind == "funding" else "special_issue",
            deadline_date=dl_date,
            confidence=conf,
            raw_text=raw_dl,
        ))
    return opp, lifecycle


def funding_deadline_scan(agency_list: list[str], errors: list[dict[str, str]] | None = None) -> list[Opportunity]:
    """
    Scans funding agencies for calls for proposals.

    Pass ``errors`` to collect {"source", "error"} entries for agencies that could not be read, so a
    broken source shows up in the run log and digest instead of looking like "no calls today".
    """
    opportunities: list[Opportunity] = []

    for agency in agency_list:
        agency = AGENCY_ALIASES.get(agency, agency)
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
                if errors is not None:
                    errors.append({"source": "Grants.gov", "error": str(e)})
        elif agency in AGENCY_REGISTRY:
            adapter = AGENCY_REGISTRY[agency]()
            calls = adapter.fetch_open_calls()
            if adapter.last_error and errors is not None:
                errors.append({"source": adapter.agency_name, "error": adapter.last_error})
            skipped: dict[str, int] = {}
            for call in calls:
                opp, reason = _call_to_opportunity(call, adapter.agency_name)
                if opp is None:
                    skipped[reason] = skipped.get(reason, 0) + 1
                else:
                    opportunities.append(opp)
            if skipped:
                logger.info(f"{adapter.agency_name}: skipped {skipped}")
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
