"""Pipeline orchestrator implementing Watch -> Score -> Validate -> Alert standing loop."""
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
from radar.models import Opportunity, RunSummary
from radar.notify import deadline_alert, digest_builder, email_brevo, telegram
from radar.scoring import component_scorer
from radar.tools.funding_deadline_scan import funding_deadline_scan
from radar.tools.journal_watch import journal_watch

logger = get_logger(__name__)

def should_alert(score_result) -> bool:
    if not score_result:
        return False
    if score_result.band == "high":
        return True
    return False

def run_pipeline(
    dry_run: bool = False,
    suppress_alerts: bool = False,
    telemetry_callback: Callable[[dict[str, Any]], None] | None = None
) -> RunSummary:
    config.validate_required_config()
    run_id = db.start_run_log()
    summary = RunSummary(run_id=run_id, started_at=datetime.now(UTC))

    try:
        profile = faculty_profile_store.get_active_profile()
        profile_terms = faculty_profile_store.get_profile_terms(profile.id)

        if telemetry_callback:
            telemetry_callback({
                "agent": "FacultyMemoryStore",
                "phase": "INIT",
                "level": "INFO",
                "stepIndex": 1,
                "message": f"Loaded active faculty calibration profile: {profile.full_name} ({profile.institution}).",
                "timestamp": datetime.now(UTC).isoformat()
            })

        # WATCH
        found: list[Opportunity] = []
        failed_sources: list[dict[str, str]] = []

        # 1. OpenAlex, Crossref & Semantic Scholar via journal_watch
        for kw in profile.research_keywords:
            src_label = f"journal_watch({kw})"
            sr_id = db.start_source_run(run_id, src_label)
            t0 = datetime.now()
            try:
                items = journal_watch(kw)
                found.extend(items)
                lat = int((datetime.now() - t0).total_seconds() * 1000)
                db.finish_source_run(sr_id, status="success", request_count=1, inserted_count=len(items), latency_ms=lat)
                logger.info(f"Retrieved {len(items)} works for '{kw}'", run_id=run_id, source_name=src_label)
            except Exception as e:
                lat = int((datetime.now() - t0).total_seconds() * 1000)
                db.finish_source_run(sr_id, status="failed", error_count=1, error_category="api_error", latency_ms=lat)
                failed_sources.append({"source": src_label, "error": str(e)})
                logger.error(f"journal_watch error: {e}", run_id=run_id, source_name=src_label, error_category="api_error")

        # 2. Funding deadline scan
        sr_id = db.start_source_run(run_id, "funding_deadline_scan")
        t0 = datetime.now()
        try:
            funding_items = funding_deadline_scan(config.AGENCY_LIST)
            found.extend(funding_items)
            lat = int((datetime.now() - t0).total_seconds() * 1000)
            db.finish_source_run(sr_id, status="success", request_count=1, inserted_count=len(funding_items), latency_ms=lat)
            logger.info(f"Retrieved {len(funding_items)} funding opportunities", run_id=run_id, source_name="funding_deadline_scan")
        except Exception as e:
            lat = int((datetime.now() - t0).total_seconds() * 1000)
            db.finish_source_run(sr_id, status="failed", error_count=1, error_category="api_error", latency_ms=lat)
            failed_sources.append({"source": "Grants.gov / Agency Scans", "error": str(e)})
            logger.error(f"funding_deadline_scan error: {e}", run_id=run_id, source_name="funding_deadline_scan", error_category="api_error")

        # 3. Autonomous Discovery Agent (unindexed calls, arXiv preprints, special issues)
        sr_id = db.start_source_run(run_id, "autonomous_discovery_agent")
        t0 = datetime.now()
        try:
            discovery_agent = DiscoveryAgent(telemetry_callback=telemetry_callback)
            discovered = discovery_agent.run_discovery_cycle(profile, profile_terms)
            found.extend(discovered)
            lat = int((datetime.now() - t0).total_seconds() * 1000)
            db.finish_source_run(sr_id, status="success", request_count=1, inserted_count=len(discovered), latency_ms=lat)
            logger.info(f"Discovered {len(discovered)} unindexed/special opportunities", run_id=run_id, source_name="autonomous_discovery_agent")
        except Exception as e:
            lat = int((datetime.now() - t0).total_seconds() * 1000)
            db.finish_source_run(sr_id, status="failed", error_count=1, error_category="api_error", latency_ms=lat)
            failed_sources.append({"source": "Autonomous Discovery (NSF/WikiCFP/ArXiv)", "error": str(e)})
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

        # SCORE
        negative_signals = db.load_feedback_signals(rating="not_relevant")
        if telemetry_callback:
            telemetry_callback({
                "agent": "ScoringAgent",
                "phase": "RESONANCE",
                "level": "INFO",
                "stepIndex": 3,
                "message": f"Computing multi-factor resonance (embeddings + weighted domain terms + {len(negative_signals)} feedback signals) across {len(to_score)} candidates...",
                "timestamp": datetime.now(UTC).isoformat()
            })
        for opp in to_score:
            opp.score_result = component_scorer.score_opportunity(
                opp, profile, profile_terms, negative_signals=negative_signals
            )

        # COMPLIANCE (Eligibility Gatekeeper Agent)
        eligibility_agent = EligibilityAgent(telemetry_callback=telemetry_callback)
        for opp in to_score:
            eligibility_agent.evaluate_opportunity(opp, profile)

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

        # ALERT
        should_send_alerts = not dry_run and not suppress_alerts
        to_alert = [o for o, _ in accepted if o.is_new and should_alert(o.score_result)]
        if to_alert and should_send_alerts:
            digest_md = digest_builder.build(to_alert, failed_sources=failed_sources)
            if config.TELEGRAM_BOT_TOKEN and config.TELEGRAM_CHAT_ID:
                try:
                    telegram.send(digest_md)
                except Exception as e:
                    logger.error(f"Telegram digest alert failed: {e}", run_id=run_id, source_name="telegram", error_category="alert_error")
                    summary.errors.append(f"Telegram alert error: {e}")
            if config.BREVO_API_KEY:
                try:
                    email_brevo.send("Weekly Research Opportunity Digest", digest_md)
                except Exception as e:
                    logger.error(f"Brevo digest email failed: {e}", run_id=run_id, source_name="brevo", error_category="alert_error")
                    summary.errors.append(f"Brevo email error: {e}")
            try:
                ics_builder.regenerate_and_upload()
            except Exception as e:
                logger.error(f"ICS calendar upload failed: {e}", run_id=run_id, source_name="calendar", error_category="calendar_error")
                summary.errors.append(f"ICS upload error: {e}")

        # URGENT DEADLINE SENTINEL (≤ 72 Hours)
        urgent_alerts = deadline_alert.check_and_send_urgent_deadline_alerts(
            faculty_id=profile.id if profile else None,
            dry_run=(dry_run or suppress_alerts)
        )

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
