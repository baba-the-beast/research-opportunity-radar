"""Urgent 72-hour deadline sentinel and dispatcher."""
import logging
from datetime import UTC, date, datetime
from typing import Any

from radar import config
from radar.db import client as db
from radar.notify import email_brevo, telegram

logger = logging.getLogger(__name__)


def check_and_send_urgent_deadline_alerts(
    faculty_id: str | None = None,
    reference_date: date | None = None,
    dry_run: bool = False
) -> list[dict[str, Any]]:
    """
    Scans for opportunities with confirmed/probable deadlines occurring within 72 hours (<= 3 days).
    Dispatches immediate high-priority alerts via Telegram and Brevo, deduplicating via `alerts_sent`.
    """
    today = reference_date or datetime.now(UTC).date()
    client = db.get_client()

    # Resolve faculty_id if not explicitly provided
    if not faculty_id:
        try:
            prof_res = client.table("faculty_profile").select("id").limit(1).execute()
            if prof_res.data:
                faculty_id = prof_res.data[0]["id"]
        except Exception:
            pass

    opportunities = db.load_recent_opportunities(limit=500)
    dispatched_alerts: list[dict[str, Any]] = []

    for opp in opportunities:
        for dl in opp.deadlines:
            if not dl.deadline_date:
                continue
            if dl.confidence not in ("confirmed", "probable"):
                continue

            days_left = (dl.deadline_date - today).days
            if 0 <= days_left <= 3:
                dedupe_key = f"{opp.id}:deadline_urgent:{dl.deadline_date.isoformat()}"

                # Check deduplication in alerts_sent
                try:
                    sent_check = client.table("alerts_sent").select("id").eq("dedupe_key", dedupe_key).execute()
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
                    "url": opp.primary_source_url or "https://radar.observatory.internal",
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
                    if config.TELEGRAM_BOT_TOKEN and config.TELEGRAM_CHAT_ID:
                        try:
                            telegram.send(alert_text)
                        except Exception as e:
                            logger.error(f"Telegram urgent alert failed: {e}")

                    if config.BREVO_API_KEY:
                        try:
                            email_brevo.send(
                                f"URGENT [{days_left}d]: {opp.title[:60]}",
                                alert_text
                            )
                        except Exception as e:
                            logger.error(f"Brevo urgent alert email failed: {e}")

                    # Record in alerts_sent table
                    try:
                        if faculty_id and opp.id:
                            client.table("alerts_sent").insert({
                                "opportunity_id": opp.id,
                                "faculty_id": faculty_id,
                                "channel": "telegram" if config.TELEGRAM_BOT_TOKEN else "dashboard",
                                "alert_type": "deadline_urgent",
                                "dedupe_key": dedupe_key,
                                "sent_at": datetime.now(UTC).isoformat()
                            }).execute()
                    except Exception as e:
                        logger.error(f"Failed to record alert in alerts_sent: {e}")

                dispatched_alerts.append(alert_payload)

    return dispatched_alerts
