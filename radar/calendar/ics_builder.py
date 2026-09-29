"""iCalendar (.ics) feed generator and Supabase storage uploader."""
import hashlib
from datetime import datetime

from ics import Calendar, Event

from radar.db import client as db_client
from radar.deadlines.deadline_engine import today_ist
from radar.logging_config import get_logger

logger = get_logger(__name__)

DEFAULT_TZ = "Asia/Kolkata"  # schema default for opportunity_deadlines.timezone
_TZ_NAMES = {"Asia/Kolkata": "IST — Indian Standard Time"}


def _tz_label(tz: str) -> str:
    return f"{tz} ({_TZ_NAMES[tz]})" if tz in _TZ_NAMES else tz


def generate_ics_content() -> str:
    client = db_client.get_client()
    res = client.table("opportunity_deadlines").select("*, opportunities(title, kind, doi, opportunity_sources(source_url))").in_("confidence", ["confirmed", "probable"]).execute()

    today = today_ist()
    cal = Calendar()
    timezones: set[str] = set()

    for row in res.data or []:
        deadline_date_str = row.get("deadline_date")
        if not deadline_date_str:
            continue

        try:
            dl_date = datetime.strptime(deadline_date_str, "%Y-%m-%d").date()
        except ValueError:
            continue

        if dl_date < today:
            continue  # past deadlines only clutter subscribers' calendars

        opp = row.get("opportunities") or {}
        title = opp.get("title", "Research Deadline")
        sources = opp.get("opportunity_sources") or []
        url = sources[0].get("source_url") if sources else None
        tz = row.get("timezone") or DEFAULT_TZ
        timezones.add(tz)

        event = Event()
        # Stable UID: calendar apps update the same event on every regeneration instead of duplicating it
        key = row.get("opportunity_id") or hashlib.sha1(f"{title}|{deadline_date_str}".encode()).hexdigest()[:16]
        event.uid = f"{key}-{row.get('deadline_type', 'submission')}@research-opportunity-radar"
        event.name = f"[{row.get('deadline_type', 'submission').upper()}] {title}"
        event.begin = dl_date.isoformat()
        event.make_all_day()
        event.description = (
            f"Research Opportunity Deadline ({row.get('deadline_type')})\n"
            f"Timezone: {_tz_label(tz)}\n"
            + (f"Call details: {url}" if url else "")
        )
        if url:
            event.url = url
        cal.events.add(event)

    # X-WR-TIMEZONE tells Google Calendar, Apple Calendar and Outlook which zone to show all-day
    # deadlines in. Only declare it when every deadline shares one zone (normally IST); a mixed
    # calendar must not claim a single zone, and each event's description names its own.
    ics_text = str(cal)
    if "X-WR-TIMEZONE" not in ics_text:
        header = "BEGIN:VCALENDAR\r\nX-WR-CALNAME:Research Opportunity Radar"
        if len(timezones) <= 1:
            only_tz = next(iter(timezones), DEFAULT_TZ)
            header = f"BEGIN:VCALENDAR\r\nX-WR-TIMEZONE:{only_tz}\r\nX-WR-CALNAME:Research Opportunity Radar"
            if only_tz == DEFAULT_TZ:
                header += " (IST)"
        ics_text = ics_text.replace("BEGIN:VCALENDAR", header, 1)

    return ics_text


def regenerate_and_upload() -> str | None:
    try:
        ics_text = generate_ics_content()
        client = db_client.get_client()

        bucket_name = "calendars"
        file_path = "deadlines.ics"

        # Check/create bucket
        try:
            client.storage.get_bucket(bucket_name)
        except Exception:
            try:
                client.storage.create_bucket(bucket_name, options={"public": True})
            except Exception:
                pass

        client.storage.from_(bucket_name).upload(
            file_path,
            ics_text.encode("utf-8"),
            file_options={"content-type": "text/calendar", "upsert": "true"}
        )
        return client.storage.from_(bucket_name).get_public_url(file_path)
    except Exception as e:
        logger.error(f"Failed to upload ICS feed to Supabase Storage: {e}", source_name="calendar", error_category="calendar_error")
        raise
