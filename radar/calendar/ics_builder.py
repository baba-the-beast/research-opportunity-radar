"""iCalendar (.ics) feed generator and Supabase storage uploader."""
from datetime import datetime

from ics import Calendar, Event

from radar.db import client as db_client


def generate_ics_content() -> str:
    client = db_client.get_client()
    res = client.table("opportunity_deadlines").select("*, opportunities(title, kind, doi, opportunity_sources(source_url))").eq("confidence", "confirmed").execute()

    cal = Calendar()

    for row in res.data or []:
        deadline_date_str = row.get("deadline_date")
        if not deadline_date_str:
            continue

        try:
            dl_date = datetime.strptime(deadline_date_str, "%Y-%m-%d").date()
        except ValueError:
            continue

        opp = row.get("opportunities") or {}
        title = opp.get("title", "Research Deadline")
        sources = opp.get("opportunity_sources") or []
        url = sources[0].get("source_url") if sources else "https://example.com"

        event = Event()
        event.name = f"[{row.get('deadline_type', 'submission').upper()}] {title}"
        event.begin = dl_date.isoformat()
        event.make_all_day()
        event.description = f"Research Opportunity Deadline ({row.get('deadline_type')})\nCitation URL: {url}"
        event.url = url
        cal.events.add(event)

    return str(cal)

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
        print(f"Failed to upload ICS feed to Supabase Storage: {e}")
        return None
