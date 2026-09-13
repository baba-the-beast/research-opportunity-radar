from datetime import UTC, datetime, timedelta

from radar.db import client as db


def test_archive_stale_opportunities():
    from radar import config
    config.ALLOW_IN_MEMORY_DB = True
    in_mem_client = db.get_client()

    now = datetime.now(UTC)
    old_date = (now - timedelta(days=120)).date().isoformat()
    recent_date = (now - timedelta(days=30)).date().isoformat()
    future_date = (now + timedelta(days=30)).date().isoformat()

    # Reset tables
    in_mem_client.table("opportunities")._rows = [
        {"id": "opp-old", "title": "Old Conf", "status": "open", "fingerprint": "fp-1"},
        {"id": "opp-recent", "title": "Recent Conf", "status": "open", "fingerprint": "fp-2"},
        {"id": "opp-multi", "title": "Multi Deadline Conf", "status": "open", "fingerprint": "fp-3"},
    ]
    in_mem_client.table("opportunity_deadlines")._rows = [
        {"id": "dl-1", "opportunity_id": "opp-old", "deadline_date": old_date},
        {"id": "dl-2", "opportunity_id": "opp-recent", "deadline_date": recent_date},
        {"id": "dl-3a", "opportunity_id": "opp-multi", "deadline_date": old_date},
        {"id": "dl-3b", "opportunity_id": "opp-multi", "deadline_date": future_date},
    ]

    archived = db.archive_stale_opportunities(older_than_days=90)
    assert archived == 1

    opps = {r["id"]: r for r in in_mem_client.table("opportunities")._rows}
    assert opps["opp-old"]["status"] == "archived"
    assert opps["opp-recent"]["status"] == "open"
    assert opps["opp-multi"]["status"] == "open"
    # Ensure fingerprint preserved
    assert opps["opp-old"]["fingerprint"] == "fp-1"
