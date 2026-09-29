"""Pipeline orchestrator implementing Watch -> Score -> Validate -> Alert standing loop."""
import dataclasses
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from radar import config
from radar.agents.discovery_agent import DiscoveryAgent
from radar.agents.eligibility_agent import EligibilityAgent
from radar.calendar import ics_builder
from radar.db import client as db
from radar.dedup import fingerprint
from radar.governance import rules as governance
from radar.logging_config import get_logger
from radar.memory import faculty_profile_store
from radar.models import FacultyProfile, Opportunity, ProfileTerm, RunSummary
from radar.notify import deadline_alert, digest_builder, email_brevo, recipients, telegram  # noqa: F401
from radar.scoring import component_scorer
from radar.sources import pdf_details
from radar.tools.funding_deadline_scan import funding_deadline_scan

logger = get_logger(__name__)

def should_alert(score_result) -> bool:
    if not score_result:
        return False
    if score_result.band == "high":
        return True
    return False

MAX_SCAN_KEYWORDS = 30
# One source name for every keyword search. sources/source_runs are readable by all signed-in users
# (activity feed), so a per-keyword name like "journal_watch(<keyword>)" leaked private profiles.
SCHOLARLY_SEARCH_SOURCE = "Scholarly literature search (OpenAlex / Crossref / Semantic Scholar)"
RESCORE_CATALOG_LIMIT = 200


def _union_keywords(profiles: list[FacultyProfile]) -> list[str]:
    """Research keywords to scan, de-duplicated case-insensitively and capped at MAX_SCAN_KEYWORDS.

    Taken round-robin (each profile's 1st keyword, then each one's 2nd, ...) so the cap is shared
    fairly: newer users are never starved just because earlier profiles hold many keywords.
    """
    seen: set[str] = set()
    merged: list[str] = []
    queues = [[kw.strip() for kw in p.research_keywords if kw.strip()] for p in profiles]
    depth = max((len(q) for q in queues), default=0)
    for i in range(depth):
        for queue in queues:
            if i < len(queue) and queue[i].lower() not in seen:
                seen.add(queue[i].lower())
                merged.append(queue[i])
                if len(merged) == MAX_SCAN_KEYWORDS:
                    return merged
    return merged


def _public_source_failures(failed_sources: list[dict[str, str]]) -> list[dict[str, str]]:
    """Failure notes safe to show every recipient. Keyword searches are labelled with the keyword
    (from some user's private profile) and request errors often embed the query URL, so digests get
    source names only; full detail stays in logs and run_log for operators."""
    public: list[dict[str, str]] = []
    seen: set[str] = set()
    for fs in failed_sources:
        label = fs.get("source", "Unknown source")
        if label.startswith("journal_watch("):  # label format used before SCHOLARLY_SEARCH_SOURCE
            label = SCHOLARLY_SEARCH_SOURCE
        if label not in seen:
            seen.add(label)
            public.append({"source": label, "error": "temporarily unavailable"})
    return public


def _score_for_profiles(
    opps: list[Opportunity],
    profiles: list[FacultyProfile],
    terms_by_profile: dict[str, list[ProfileTerm]],
    eligibility_agent: EligibilityAgent,
) -> None:
    """Score and eligibility-check every opportunity against every profile.

    Fills opp.profile_scores[faculty_id]; opp.score_result becomes the best eligible score, which is
    what the opportunity-level governance gate checks. The per-profile eligibility report is moved out
    of the shared opp.metadata so it is only persisted in that faculty's (RLS-scoped) scoring_log row.
    """
    for profile in profiles:
        negative_signals = db.load_feedback_signals(rating="not_relevant", faculty_id=profile.id)
        for opp in opps:
            score = component_scorer.score_opportunity(
                opp, profile, terms_by_profile[profile.id], negative_signals=negative_signals
            )
            report = eligibility_agent.evaluate_opportunity(opp, profile)
            score.eligibility_report = opp.metadata.pop("eligibility_report", None) or report.to_dict()
            if report.status == "DISQUALIFIED":
                score.band = "not_eligible"
            opp.profile_scores[profile.id] = score

    for opp in opps:
        eligible = [sc for sc in opp.profile_scores.values() if sc.band != "not_eligible"]
        if eligible:
            opp.score_result = max(eligible, key=lambda sc: sc.final_score)
        else:
            # Ineligible for every faculty member: let the governance gate drop it
            opp.score_result = max(opp.profile_scores.values(), key=lambda sc: sc.final_score, default=None)
            opp.metadata["eligibility_report"] = {
                "status": "DISQUALIFIED",
                "summary": "ineligible for every active faculty profile",
            }


def run_pipeline(
    dry_run: bool = False,
    suppress_alerts: bool = False,
    telemetry_callback: Callable[[dict[str, Any]], None] | None = None
) -> RunSummary:
    config.validate_required_config()
    run_id = db.start_run_log()
    summary = RunSummary(run_id=run_id, started_at=datetime.now(UTC))

    lock_id = f"pipeline-{run_id[:8]}"
    # Renewed from a background thread for the whole run: multi-profile runs can outlast any fixed TTL
    lease = db.PipelineLease("radar_pipeline_global", locked_by=lock_id)
    if not lease.acquire():
        msg = "Pipeline execution rejected: another pipeline run is currently in progress."
        logger.warning(msg, run_id=run_id, source_name="orchestrator")
        db.finish_run_log(run_id, status="failed", errors=[msg])
        if telemetry_callback:
            telemetry_callback({
                "agent": "Orchestrator",
                "phase": "ABORT",
                "level": "ERROR",
                "stepIndex": 1,
                "message": msg,
                "timestamp": datetime.now(UTC).isoformat()
            })
        raise RuntimeError(msg)

    try:
        profiles = faculty_profile_store.get_all_profiles()
        terms_by_profile = {p.id: faculty_profile_store.get_profile_terms(p.id) for p in profiles}
        scan_keywords = _union_keywords(profiles)
        # One merged profile drives source discovery so each source is queried once per run,
        # not once per user; scoring below is still per profile.
        discovery_profile = dataclasses.replace(profiles[0], research_keywords=scan_keywords)
        discovery_terms = [t for terms in terms_by_profile.values() for t in terms]

        if telemetry_callback:
            telemetry_callback({
                "agent": "FacultyMemoryStore",
                "phase": "INIT",
                "level": "INFO",
                "stepIndex": 1,
                "message": f"Loaded {len(profiles)} faculty calibration profile(s); scanning {len(scan_keywords)} distinct research keywords.",
                "timestamp": datetime.now(UTC).isoformat()
            })

        # WATCH
        found: list[Opportunity] = []
        failed_sources: list[dict[str, str]] = []

        # Published papers (OpenAlex / Crossref / Semantic Scholar) are not opportunities and are no
        # longer scanned here: they flooded the catalog with thousands of already-published works.

        # 1. Funding calls from agency listings
        sr_id = db.start_source_run(run_id, "funding_deadline_scan")
        t0 = datetime.now()
        try:
            agency_errors: list[dict[str, str]] = []
            funding_items = funding_deadline_scan(config.AGENCY_LIST, errors=agency_errors)
            found.extend(funding_items)
            lat = int((datetime.now() - t0).total_seconds() * 1000)
            failed_sources.extend(agency_errors)
            for err in agency_errors:
                logger.error(f"Agency source failed: {err['error']}", run_id=run_id, source_name=err["source"], error_category="source_error")
                summary.errors.append(f"{err['source']} unavailable: {err['error']}")
            db.finish_source_run(
                sr_id, status="partial_failure" if agency_errors else "success", request_count=len(config.AGENCY_LIST),
                inserted_count=len(funding_items), error_count=len(agency_errors), latency_ms=lat,
            )
            logger.info(f"Retrieved {len(funding_items)} funding opportunities", run_id=run_id, source_name="funding_deadline_scan")
        except Exception as e:
            lat = int((datetime.now() - t0).total_seconds() * 1000)
            db.finish_source_run(sr_id, status="failed", error_count=1, error_category="api_error", latency_ms=lat)
            failed_sources.append({"source": "Grants.gov / Agency Scans", "error": str(e)})
            logger.error(f"funding_deadline_scan error: {e}", run_id=run_id, source_name="funding_deadline_scan", error_category="api_error")

        # 2. Discovery agent: conference / journal calls for papers (and NSF if US sources are enabled)
        sr_id = db.start_source_run(run_id, "autonomous_discovery_agent")
        t0 = datetime.now()
        try:
            discovery_agent = DiscoveryAgent(telemetry_callback=telemetry_callback)
            discovered = discovery_agent.run_discovery_cycle(discovery_profile, discovery_terms)
            found.extend(discovered)
            lat = int((datetime.now() - t0).total_seconds() * 1000)
            # One entry per failing source, not per failed keyword request
            discovery_errors = list({e["source"]: e for e in discovery_agent.errors}.values())
            failed_sources.extend(discovery_errors)
            summary.errors.extend(f"{e['source']} unavailable: {e['error']}" for e in discovery_errors)
            db.finish_source_run(
                sr_id, status="partial_failure" if discovery_errors else "success", request_count=1,
                inserted_count=len(discovered), error_count=len(discovery_errors), latency_ms=lat,
            )
            logger.info(f"Discovered {len(discovered)} unindexed/special opportunities", run_id=run_id, source_name="autonomous_discovery_agent")
        except Exception as e:
            lat = int((datetime.now() - t0).total_seconds() * 1000)
            db.finish_source_run(sr_id, status="failed", error_count=1, error_category="api_error", latency_ms=lat)
            failed_sources.append({"source": "Calls for papers (WikiCFP)", "error": str(e)})
            logger.error(f"discovery_agent error: {e}", run_id=run_id, source_name="autonomous_discovery_agent", error_category="api_error")

        summary.opportunities_found = len(found)

        # DEDUPLICATE
        existing = db.load_recent_opportunities()
        to_score: list[Opportunity] = []
        provenance_updates: list[tuple[str, str, str]] = []

        for cand in found:
            cand.fingerprint = fingerprint.compute_fingerprint(
                cand.kind, cand.title, cand.agency_or_publisher,
                cand.doi or cand.external_id or cand.primary_source_url
            )
            match = fingerprint.find_existing_match(cand, existing)
            if match:
                cand.is_new = False
                if match.id and cand.primary_source_name and cand.primary_source_url:
                    provenance_updates.append((match.id, cand.primary_source_name, cand.primary_source_url))
            else:
                cand.is_new = True
                to_score.append(cand)
                existing.append(cand)

        # ENRICH new funding calls from their call PDFs (scope, eligibility, budget, stated deadline)
        try:
            pdfs_read = pdf_details.enrich_with_pdf_details(to_score)
            logger.info(f"Read {pdfs_read} call documents", run_id=run_id, source_name="pdf_details")
        except Exception as e:  # enrichment is best-effort; never block scoring
            logger.error(f"Call document enrichment failed: {e}", run_id=run_id, source_name="pdf_details")
        # A PDF may reveal that a call without a listed date has already closed
        to_score = [o for o in to_score if o.status != "closed"]

        # SCORE + COMPLIANCE (per faculty profile)
        if telemetry_callback:
            telemetry_callback({
                "agent": "ScoringAgent",
                "phase": "RESONANCE",
                "level": "INFO",
                "stepIndex": 3,
                "message": f"Computing multi-factor resonance (embeddings + weighted domain terms + per-faculty feedback) for {len(to_score)} candidates across {len(profiles)} profile(s)...",
                "timestamp": datetime.now(UTC).isoformat()
            })

        # Batch encode candidates for ML inference acceleration
        component_scorer.encode_opportunities_batch(to_score, batch_size=32)

        eligibility_agent = EligibilityAgent(telemetry_callback=telemetry_callback)
        _score_for_profiles(to_score, profiles, terms_by_profile, eligibility_agent)

        # VALIDATE (governance gate)
        accepted: list[tuple[Opportunity, str]] = []
        rejected: list[tuple[Opportunity, str]] = []
        for opp in to_score:
            ok, reason = governance.validate_before_alert(opp)
            if ok:
                accepted.append((opp, "accepted"))
            else:
                rejected.append((opp, reason or "rejected"))
                summary.errors.append(reason or "rejected")

        if telemetry_callback:
            telemetry_callback({
                "agent": "GovernanceGate",
                "phase": "ADMISSION",
                "level": "INFO",
                "stepIndex": 4,
                "message": f"Evaluated governance admission rules: {len(accepted)} compliant opportunities admitted, {len(rejected)} dropped.",
                "timestamp": datetime.now(UTC).isoformat()
            })

        # WRITE TO DB
        if not dry_run:
            new_count = db.upsert_opportunities(accepted, provenance_updates)
        else:
            new_count = len([o for o, _ in accepted if o.is_new])
            logger.info(
                f"[DRY RUN] Would write {len(accepted)} opportunities ({new_count} new) "
                f"and {len(provenance_updates)} provenance updates to DB",
                run_id=run_id,
                source_name="orchestrator"
            )
        summary.opportunities_new = new_count

        # RESCORE CATALOG for profiles that are new or were edited since the last run, so their
        # dashboard reflects the current profile rather than scores computed for someone else.
        refreshed = [p for p in profiles if p.embedding_refreshed]
        if refreshed and not dry_run:
            # Isolated per profile: a failure here must not abort the run before alerts go out.
            # A profile that fails keeps its cleared embedding, so the next run retries it.
            catalog: list[Opportunity] = []
            try:
                scored_this_run = {o.id for o, _ in accepted}
                catalog = [
                    o for o in db.load_recent_opportunities(limit=RESCORE_CATALOG_LIMIT)
                    if o.id and o.id not in scored_this_run
                ]
                component_scorer.encode_opportunities_batch(catalog, batch_size=32)
            except Exception as e:
                logger.error(f"Catalog load for rescoring failed: {e}", run_id=run_id,
                             source_name="orchestrator", error_category="rescore_error")
                summary.errors.append(f"Rescore error: {e}")
                refreshed = []

            for profile in refreshed:
                try:
                    for opp in catalog:
                        opp.profile_scores = {}
                    _score_for_profiles(catalog, [profile], terms_by_profile, eligibility_agent)
                    db.insert_scores_bulk([(opp.id, {profile.id: opp.profile_scores[profile.id]}) for opp in catalog])
                    faculty_profile_store.save_profile_embedding(profile)
                    logger.info(
                        f"Rescored {len(catalog)} catalog opportunities for profile {profile.id}",
                        run_id=run_id, source_name="orchestrator"
                    )
                except Exception as e:
                    logger.error(f"Rescoring failed for profile {profile.id}: {e}", run_id=run_id,
                                 source_name="orchestrator", error_category="rescore_error")
                    summary.errors.append(f"Rescore error for profile {profile.id}: {e}")

        # ALERT (per faculty profile, to that user's own channels)
        if lease.lost:
            # Another run may now hold the lock; sending too would duplicate every user's alerts
            msg = "Pipeline lease lost before alerting; alerts skipped for this run."
            logger.error(msg, run_id=run_id, source_name="orchestrator", error_category="lock_lost")
            summary.errors.append(msg)
        should_send_alerts = not dry_run and not suppress_alerts and not lease.lost
        new_accepted = [o for o, _ in accepted if o.is_new]
        urgent_alerts: list[dict[str, Any]] = []
        # Loaded once for every profile's deadline sentinel (previously one 500-row scan per user)
        recent_catalog = db.load_recent_opportunities(limit=500) if not lease.lost else []
        for profile in profiles if not lease.lost else []:
            # Isolated per profile: one user's bad preferences or a failed lookup must not stop
            # digests and deadline alerts for everyone after them.
            try:
                target = recipients.resolve_target(profile)
                to_alert = [
                    o for o in new_accepted
                    if should_alert(o.profile_scores.get(profile.id))
                    and o.profile_scores[profile.id].final_score >= target.min_score
                ]
                if to_alert and should_send_alerts and target.digest_enabled:
                    digest_md = digest_builder.build(
                        to_alert, failed_sources=_public_source_failures(failed_sources), faculty_id=profile.id
                    )
                    summary.errors.extend(recipients.dispatch(target, "Weekly Research Opportunity Digest", digest_md))

                # URGENT DEADLINE SENTINEL (<= 72 hours) for what this faculty tracks or scored highly
                alertable_ids = None
                if profile.user_id:
                    alertable_ids = db.load_alertable_opportunity_ids(profile.id, profile.user_id)
                urgent_alerts.extend(deadline_alert.check_and_send_urgent_deadline_alerts(
                    faculty_id=profile.id,
                    dry_run=(dry_run or suppress_alerts),
                    target=target,
                    opportunity_ids=alertable_ids,
                    opportunities=recent_catalog,
                    errors=summary.errors,
                ))
            except Exception as e:
                logger.error(f"Alerting failed for profile {profile.id}: {e}", run_id=run_id,
                             source_name="alerts", error_category="alert_error")
                summary.errors.append(f"Alert error for profile {profile.id}: {e}")

        if new_accepted and should_send_alerts:
            try:
                ics_builder.regenerate_and_upload()
            except Exception as e:
                logger.error(f"ICS calendar upload failed: {e}", run_id=run_id, source_name="calendar", error_category="calendar_error")
                summary.errors.append(f"ICS upload error: {e}")

        if urgent_alerts and telemetry_callback:
            telemetry_callback({
                "agent": "DeadlineSentinel",
                "phase": "ALERT",
                "level": "INFO",
                "stepIndex": 4,
                "message": f"Deadline Sentinel dispatched {len(urgent_alerts)} urgent 72-hour notifications.",
                "timestamp": datetime.now(UTC).isoformat()
            })

        # ARCHIVE STALE DEADLINES (>90 days past)
        if not dry_run:
            try:
                archived = db.archive_stale_opportunities(older_than_days=90)
                logger.info(
                    f"Archival policy executed: {archived} stale opportunities (>90 days past deadline) moved to 'archived'.",
                    run_id=run_id,
                    source_name="orchestrator"
                )
                if telemetry_callback:
                    telemetry_callback({
                        "agent": "ArchivalSentinel",
                        "phase": "ARCHIVE",
                        "level": "INFO",
                        "stepIndex": 4,
                        "message": f"Archival policy executed: {archived} stale opportunities archived.",
                        "timestamp": datetime.now(UTC).isoformat()
                    })
            except Exception as e:
                logger.error(f"Archival policy execution failed: {e}", run_id=run_id, source_name="orchestrator", error_category="database_error")
                summary.errors.append(f"Archival error: {e}")
        else:
            logger.info("[DRY RUN] Stale opportunities archival check skipped in dry-run mode.", run_id=run_id, source_name="orchestrator")

        status = "success" if not summary.errors else "partial_failure"
        summary.status = status
        summary.finished_at = datetime.now(UTC)

        if telemetry_callback:
            telemetry_callback({
                "agent": "Orchestrator",
                "phase": "COMPLETE",
                "level": "SUCCESS",
                "stepIndex": 4,
                "message": f"Pipeline cycle complete. {len(accepted)} verified opportunities admitted to Observatory Stream.",
                "payload": {
                    "admittedCount": len(accepted),
                    "opportunitiesFound": len(found),
                    "opportunitiesNew": new_count
                },
                "timestamp": datetime.now(UTC).isoformat()
            })

        db.finish_run_log(run_id, status=status, found=len(found), new=new_count, errors=summary.errors)
        return summary

    except Exception as e:
        summary.status = "failed"
        summary.finished_at = datetime.now(UTC)
        summary.errors.append(str(e))
        logger.error(f"Pipeline crashed: {e}", run_id=run_id, source_name="orchestrator", error_category="fatal_error")
        db.finish_run_log(run_id, status="failed", errors=[str(e)])
        raise
    finally:
        lease.release()

class OpportunityPipeline:
    """Class wrapper providing an object-oriented interface to run_pipeline."""
    @staticmethod
    def run(
        dry_run: bool = False,
        suppress_alerts: bool = False,
        telemetry_callback: Callable[[dict[str, Any]], None] | None = None
    ) -> RunSummary:
        return run_pipeline(dry_run=dry_run, suppress_alerts=suppress_alerts, telemetry_callback=telemetry_callback)

if __name__ == "__main__":
    import json
    import sys
    dry = "--dry-run" in sys.argv
    stream = "--stream" in sys.argv
    suppress = "--suppress-alerts" in sys.argv

    def _cli_telemetry(event: dict[str, Any]):
        print(f"TELEMETRY_EVENT:{json.dumps(event)}", flush=True)

    callback = _cli_telemetry if stream else None
    print(f"Running radar pipeline (dry_run={dry}, suppress_alerts={suppress}, stream={stream})...", flush=True)
    try:
        res = run_pipeline(dry_run=dry, suppress_alerts=suppress, telemetry_callback=callback)
        print(f"Pipeline finished with status '{res.status}', found: {res.opportunities_found}, new: {res.opportunities_new}", flush=True)
    except config.ConfigurationError as ce:
        print(f"\n{ce}\n", file=sys.stderr, flush=True)
        sys.exit(1)
