from datetime import UTC, datetime, timedelta

from radar.deadlines import deadline_engine


def test_deadline_urgency_buckets():
    today = datetime.now(UTC).date()
    assert deadline_engine.deadline_urgency(today - timedelta(days=1)) == "closed"
    assert deadline_engine.deadline_urgency(today + timedelta(days=2)) == "critical"
    assert deadline_engine.deadline_urgency(today + timedelta(days=5)) == "urgent"
    assert deadline_engine.deadline_urgency(today + timedelta(days=10)) == "soon"
    assert deadline_engine.deadline_urgency(today + timedelta(days=20)) == "upcoming"
    assert deadline_engine.deadline_urgency(today + timedelta(days=40)) == "distant"

def test_classify_deadline_confidence():
    date_val, conf = deadline_engine.classify_deadline_confidence("2026-10-15")
    assert date_val is not None
    assert date_val.year == 2026
    assert conf == "confirmed"

    date_val2, conf2 = deadline_engine.classify_deadline_confidence("Closing date is 2026-12-31")
    assert date_val2 is not None
    assert conf2 == "probable"
