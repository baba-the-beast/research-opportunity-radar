"""Deadline reminders: one message per deadline per reminder window the user chose."""
import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any

from radar import config
from radar.db import client as db
from radar.deadlines.deadline_engine import today_ist
from radar.models import Opportunity
from radar.notify import recipients

logger = logging.getLogger(__name__)

# The original 72-hour alert. Its dedupe key and alert type are kept so upgrading never re-sends it.
LEGACY_WINDOW_DAYS = 3


@dataclass
class PersonalDeadline:
    """A user's own date for a call, e.g. the institution's internal sign-off."""
    opportunity_id: str
    deadline_date: date
    label: str
    title: str
    agency_or_publisher: str = ""
    url: str = ""
    kind: str = "own"  # "own" (the user's my_deadline) or "institution" (set by their research office)


def reminder_window(days_left: int, windows: tuple[int, ...]) -> int | None:
    """The tightest window the deadline has entered, or None if it is outside all of them.

    Scans run twice a week, so a deadline is checked at e.g. 13, 10, 6 and 3 days out. With windows
    (14, 7, 3) those map to 14, 14, 7, 3: one reminder per window, never several at once.
    """
    if days_left < 0:
        return None
    entered = [w for w in windows if days_left <= w]
    return min(entered) if entered else None


def _dedupe_key(faculty_id: str | None, opp_id: str, window: int, deadline: date, personal: bool, kind: str = "own") -> str:
    if personal and kind == "institution":
        return f"{faculty_id}:{opp_id}:institution_deadline_{window}:{deadline.isoformat()}"
    if personal:
        return f"{faculty_id}:{opp_id}:my_deadline_{window}:{deadline.isoformat()}"
    if window == LEGACY_WINDOW_DAYS:
        return f"{faculty_id}:{opp_id}:deadline_urgent:{deadline.isoformat()}"
    return f"{faculty_id}:{opp_id}:deadline_reminder_{window}:{deadline.isoformat()}"


def _when(days_left: int) -> str:
    return "today" if days_left == 0 else "tomorrow" if days_left == 1 else f"in {days_left} days"


def check_and_send_urgent_deadline_alerts(
    faculty_id: str | None = None,
    reference_date: date | None = None,
    dry_run: bool = False,
    target: recipients.AlertTarget | None = None,
    opportunity_ids: set[str] | None = None,
    opportunities: list[Opportunity] | None = None,
    errors: list[str] | None = None,
    personal_deadlines: list[PersonalDeadline] | None = None,
) -> list[dict[str, Any]]:
    """
    Sends deadline reminders to one faculty member, deduplicated per faculty via `alerts_sent`.

    Windows come from target.reminder_days (default (3,), the original 72-hour alert). Agency
    deadlines need confirmed/probable confidence; the user's own deadlines are always trusted.

    target: where to send (defaults to the operator-wide Telegram/Brevo config).
    opportunity_ids: restrict agency deadlines to these opportunities (tracked or scored highly).
    opportunities: pre-loaded catalog, so a multi-profile run loads it once instead of per faculty.
    errors: delivery failures are appended here (the pipeline passes its run summary).
    personal_deadlines: the user's own dates on calls they track.
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
    windows = tuple(target.reminder_days)
    if not windows:
        return []  # the user turned deadline reminders off

    if opportunities is None:
        opportunities = db.load_recent_opportunities(limit=500)

    # (opp_id, title, agency, url, source, deadline date, what the date is, personal?)
    # (..., personal?, kind) where kind is "agency", "own" or "institution"
    candidates: list[tuple[str, str, str, str, str, date, str, bool, str]] = []
    for opp in opportunities:
        if not opp.id or (opportunity_ids is not None and opp.id not in opportunity_ids):
            continue
        for dl in opp.deadlines:
            if dl.deadline_date and dl.confidence in ("confirmed", "probable"):
                candidates.append((
                    opp.id, opp.title, opp.agency_or_publisher or opp.venue_name or "Unknown agency",
                    opp.primary_source_url or "", opp.primary_source_name or "Official page",
                    dl.deadline_date, dl.deadline_type.replace("_", " ").capitalize(), False, "agency",
                ))
    # A personal date that matches an agency date on the same call is already covered by that reminder
    agency_dates = {(c[0], c[5]) for c in candidates}
    for pd in personal_deadlines or []:
        if (pd.opportunity_id, pd.deadline_date) in agency_dates:
            continue
        candidates.append((
            pd.opportunity_id, pd.title, pd.agency_or_publisher or "", pd.url, "Official page",
            pd.deadline_date, pd.label or "Your deadline", True, pd.kind,
        ))

    dispatched_alerts: list[dict[str, Any]] = []
    for opp_id, title, agency, url, source_name, deadline_date, what, personal, kind in candidates:
        days_left = (deadline_date - today).days
        window = reminder_window(days_left, windows)
        if window is None:
            continue
        dedupe_key = _dedupe_key(faculty_id, opp_id, window, deadline_date, personal, kind)

        try:
            # A reminder already sent for this window or a tighter one counts too, so changing
            # reminder days (e.g. 3 -> 7 when 2 days are left) does not repeat it
            keys = [
                _dedupe_key(faculty_id, opp_id, w, deadline_date, personal, kind)
                for w in sorted({*recipients.ALLOWED_REMINDER_DAYS, LEGACY_WINDOW_DAYS, window})
                if w <= window
            ]
            # Rows written before per-faculty keys used "{opp}:deadline_urgent:{date}"; honour
            # them for the faculty they were recorded against so upgrades don't re-alert.
            if not personal and window >= LEGACY_WINDOW_DAYS:
                keys.append(f"{opp_id}:deadline_urgent:{deadline_date.isoformat()}")
            sent_check = client.table("alerts_sent").select("id").in_("dedupe_key", keys).eq("faculty_id", faculty_id).execute()
            if sent_check.data:
                continue
        except Exception as e:
            logger.warning(f"Failed to check alerts_sent dedupe_key {dedupe_key}: {e}")

        alert_payload = {
            "opportunity_id": opp_id,
            "title": title,
            "agency_or_publisher": agency,
            "deadline_date": deadline_date.isoformat(),
            "deadline_type": what,
            "days_left": days_left,
            "reminder_window": window,
            "personal": personal,
            "url": url,
            "dedupe_key": dedupe_key,
        }

        icon = "🚨" if days_left <= LEGACY_WINDOW_DAYS else "⏰"
        whose = "Your institution's deadline" if kind == "institution" else "Your deadline" if personal else "Deadline"
        heading = f"{icon} *{whose} {_when(days_left)}*"
        lines = [heading, "", f"*{title}*"]
        if agency:
            lines.append(agency)
        lines.append(f"{what}: {deadline_date.strftime('%d %b %Y').lstrip('0')}")
        if url:
            lines.append(f"[{source_name}]({url})")
        alert_text = "\n".join(lines)

        if not dry_run:
            # Counted before sending: dispatch() disconnects a blocked Telegram chat mid-send
            channels = target.enabled_channels
            subject = f"{whose} {_when(days_left)}: {title[:60]}"
            send_errors = recipients.dispatch(target, subject, alert_text)
            if send_errors and errors is not None:
                errors.extend(send_errors)
            if channels and len(send_errors) >= channels:
                # Every channel failed: leave it unrecorded so the next run retries it
                continue

            try:
                if faculty_id and opp_id:
                    client.table("alerts_sent").insert({
                        "opportunity_id": opp_id,
                        "faculty_id": faculty_id,
                        "channel": target.channel,
                        "alert_type": "deadline_urgent" if (window == LEGACY_WINDOW_DAYS and not personal) else "deadline_reminder",
                        "dedupe_key": dedupe_key,
                        "sent_at": datetime.now(UTC).isoformat(),
                    }).execute()
            except Exception as e:
                logger.error(f"Failed to record alert in alerts_sent: {e}")

        dispatched_alerts.append(alert_payload)

    return dispatched_alerts
