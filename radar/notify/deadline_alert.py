"""Urgent 72-hour deadline sentinel and dispatcher."""
import logging
from datetime import UTC, date, datetime
from typing import Any

from radar import config
from radar.db import client as db
from radar.deadlines.deadline_engine import today_ist
from radar.models import Opportunity
from radar.notify import recipients

logger = logging.getLogger(__name__)


def check_and_send_urgent_deadline_alerts(
    faculty_id: str | None = None,
    reference_date: date | None = None,
    dry_run: bool = False,
    target: recipients.AlertTarget | None = None,
    opportunity_ids: set[str] | None = None,
    opportunities: list[Opportunity] | None = None,
    errors: list[str] | None = None
) -> list[dict[str, Any]]:
    """
    Scans for opportunities with confirmed/probable deadlines occurring within 72 hours (<= 3 days)
    and alerts one faculty member, deduplicating per faculty via `alerts_sent`.

    target: where to send (defaults to the operator-wide Telegram/Brevo config).
    opportunity_ids: restrict to these opportunities (e.g. the ones this faculty tracks or scored highly).
    opportunities: pre-loaded catalog, so a multi-profile run loads it once instead of per faculty.
    errors: delivery failures are appended here (the pipeline passes its run summary).
    """
    today = reference_date or today_ist()
    client = db.get_client()

    # Resolve faculty_id if not explicitly provided
    if not faculty_id:
        try:
            prof_res = client.table("faculty_profile").select("id").order("created_at").limit(1).execute()
            if prof_res.data:
                faculty_id = prof_res.data[0]["id"]
        except Exception:
            pass

    if target is None:
        target = recipients.AlertTarget(
            faculty_id=faculty_id or "",
            telegram_chat_id=config.TELEGRAM_CHAT_ID or None,
            email=config.BREVO_RECIPIENT_EMAIL or None,
        )

    if opportunities is None:
        opportunities = db.load_recent_opportunities(limit=500)
    dispatched_alerts: list[dict[str, Any]] = []

    for opp in opportunities:
        if opportunity_ids is not None and opp.id not in opportunity_ids:
            continue
        for dl in opp.deadlines:
            if not dl.deadline_date:
                continue
            if dl.confidence not in ("confirmed", "probable"):
                continue

            days_left = (dl.deadline_date - today).days
            if 0 <= days_left <= 3:
                dedupe_key = f"{faculty_id}:{opp.id}:deadline_urgent:{dl.deadline_date.isoformat()}"

                # Check deduplication in alerts_sent
                try:
                    # Rows written before per-faculty keys used "{opp}:deadline_urgent:{date}"; honour
                    # them for the faculty they were recorded against so upgrades don't re-alert.
                    legacy_key = f"{opp.id}:deadline_urgent:{dl.deadline_date.isoformat()}"
                    sent_check = (
                        client.table("alerts_sent").select("id")
                        .in_("dedupe_key", [dedupe_key, legacy_key])
                        .eq("faculty_id", faculty_id)
                        .execute()
                    )
                    if sent_check.data:
                        # Already notified
                        continue
                except Exception as e:
                    logger.warning(f"Failed to check alerts_sent dedupe_key {dedupe_key}: {e}")

                alert_payload = {
                    "opportunity_id": opp.id,
                    "title": opp.title,
                    "agency_or_publisher": opp.agency_or_publisher or opp.venue_name or "Unknown Agency",
                    "deadline_date": dl.deadline_date.isoformat(),
                    "deadline_type": dl.deadline_type,
                    "days_left": days_left,
                    "url": opp.primary_source_url or "",
                    "dedupe_key": dedupe_key
                }

                alert_text = (
                    f"🚨 *CRITICAL DEADLINE SENTINEL* (≤ 72 Hours Remaining)\n\n"
                    f"*Title*: {opp.title}\n"
                    f"*Agency/Venue*: {alert_payload['agency_or_publisher']}\n"
                    f"*Deadline*: {alert_payload['deadline_date']} (*{days_left} day{'s' if days_left != 1 else ''} left*)\n"
                    f"*Type*: {dl.deadline_type.replace('_', ' ').title()}\n"
                    f"*Source*: [{opp.primary_source_name or 'Direct'}]({alert_payload['url']})"
                )

                if not dry_run:
                    # Counted before sending: dispatch() disconnects a blocked Telegram chat mid-send
                    channels = target.enabled_channels
                    send_errors = recipients.dispatch(target, f"URGENT [{days_left}d]: {opp.title[:60]}", alert_text)
                    if send_errors and errors is not None:
                        errors.extend(send_errors)
                    if channels and len(send_errors) >= channels:
                        # Every channel failed: leave it unrecorded so the next run retries it
                        continue

                    # Record in alerts_sent table
                    try:
                        if faculty_id and opp.id:
                            client.table("alerts_sent").insert({
                                "opportunity_id": opp.id,
                                "faculty_id": faculty_id,
                                "channel": target.channel,
                                "alert_type": "deadline_urgent",
                                "dedupe_key": dedupe_key,
                                "sent_at": datetime.now(UTC).isoformat()
                            }).execute()
                    except Exception as e:
                        logger.error(f"Failed to record alert in alerts_sent: {e}")

                dispatched_alerts.append(alert_payload)

    return dispatched_alerts
