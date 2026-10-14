"""Unit test verifying urgent 72-hour deadline alerts and deduplication."""
from datetime import date, timedelta

import pytest

from radar import config
from radar.db import client as db
from radar.models import Opportunity, OpportunityDeadline
from radar.notify import deadline_alert


@pytest.fixture(autouse=True)
def setup_alert_env(monkeypatch):
    monkeypatch.setenv("ALLOW_IN_MEMORY_DB", "1")
    config.ALLOW_IN_MEMORY_DB = True
    db._in_memory_client = None
    db._supabase_client = None


def test_urgent_deadline_alert_detection(monkeypatch):
    today = date(2026, 9, 15)

    # Opp 1: 2 days away (urgent)
    opp1 = Opportunity(
        id="opp-urgent-1",
        kind="funding",
        title="NSF Cyber-Physical Systems Urgent Call",
        agency_or_publisher="NSF",
        fingerprint="fp-urgent-1",
        deadlines=[
            OpportunityDeadline(
                deadline_type="full_proposal",
                deadline_date=today + timedelta(days=2),
                confidence="confirmed"
            )
        ]
    )

    # Opp 2: 10 days away (not urgent)
    opp2 = Opportunity(
        id="opp-future-2",
        kind="funding",
        title="NIH Regular Grant Call",
        agency_or_publisher="NIH",
        fingerprint="fp-future-2",
        deadlines=[
            OpportunityDeadline(
                deadline_type="full_proposal",
                deadline_date=today + timedelta(days=10),
                confidence="confirmed"
            )
        ]
    )

    # Opp 3: 1 day away but unknown confidence (should not trigger)
    opp3 = Opportunity(
        id="opp-unknown-3",
        kind="funding",
        title="Unverified Call",
        agency_or_publisher="Unknown",
        fingerprint="fp-unknown-3",
        deadlines=[
            OpportunityDeadline(
                deadline_type="full_proposal",
                deadline_date=today + timedelta(days=1),
                confidence="unknown"
            )
        ]
    )

    # Mock load_recent_opportunities
    monkeypatch.setattr(db, "load_recent_opportunities", lambda limit=500: [opp1, opp2, opp3])

    # Run 1: Should detect opp1 only
    alerts = deadline_alert.check_and_send_urgent_deadline_alerts(
        faculty_id="prof-1",
        reference_date=today,
        dry_run=False
    )
    assert len(alerts) == 1
    assert alerts[0]["opportunity_id"] == "opp-urgent-1"
    assert alerts[0]["days_left"] == 2

    # Run 2: Same opportunities - deduplication via alerts_sent must prevent re-alerting
    alerts_second = deadline_alert.check_and_send_urgent_deadline_alerts(
        faculty_id="prof-1",
        reference_date=today,
        dry_run=False
    )
    assert len(alerts_second) == 0


# --- Reminder windows the user chooses -----------------------------------------------------------

from radar.notify import recipients  # noqa: E402


def _opp(opp_id: str, due: date, confidence: str = "confirmed") -> Opportunity:
    return Opportunity(
        id=opp_id, kind="funding", title=f"Call {opp_id}", agency_or_publisher="ANRF", fingerprint=f"fp-{opp_id}",
        deadlines=[OpportunityDeadline(deadline_type="full_proposal", deadline_date=due, confidence=confidence)],
    )


def _target(*windows: int) -> recipients.AlertTarget:
    return recipients.AlertTarget(faculty_id="prof-w", reminder_days=tuple(windows))


@pytest.mark.parametrize(
    ("days_left", "windows", "expected"),
    [
        (13, (14, 7, 3), 14),
        (7, (14, 7, 3), 7),
        (6, (14, 7, 3), 7),
        (3, (14, 7, 3), 3),
        (0, (14, 7, 3), 3),
        (20, (14, 7, 3), None),
        (-1, (14, 7, 3), None),
        (2, (7,), 7),
        (2, (), None),
    ],
)
def test_reminder_window_picks_tightest_entered(days_left, windows, expected):
    assert deadline_alert.reminder_window(days_left, windows) == expected


def test_one_reminder_per_window_across_scans():
    due = date(2026, 10, 30)
    opp = _opp("w-1", due)
    sent_windows = []
    # Scans twice a week at 13, 10, 6, 3 and 2 days before the deadline
    for days_before in (13, 10, 6, 3, 2):
        sent = deadline_alert.check_and_send_urgent_deadline_alerts(
            faculty_id="prof-w", reference_date=due - timedelta(days=days_before),
            target=_target(14, 7, 3), opportunities=[opp],
        )
        sent_windows.extend(a["reminder_window"] for a in sent)
    assert sent_windows == [14, 7, 3]


def test_three_day_window_keeps_legacy_dedupe_key():
    due = date(2026, 10, 30)
    sent = deadline_alert.check_and_send_urgent_deadline_alerts(
        faculty_id="prof-w", reference_date=due - timedelta(days=2), target=_target(3), opportunities=[_opp("w-2", due)],
    )
    assert sent[0]["dedupe_key"] == f"prof-w:w-2:deadline_urgent:{due.isoformat()}"


def test_reminders_off_sends_nothing():
    due = date(2026, 10, 30)
    sent = deadline_alert.check_and_send_urgent_deadline_alerts(
        faculty_id="prof-w", reference_date=due - timedelta(days=1), target=_target(), opportunities=[_opp("w-3", due)],
    )
    assert sent == []


def test_personal_deadline_is_reminded_and_labelled():
    today = date(2026, 10, 1)
    personal = [deadline_alert.PersonalDeadline(
        opportunity_id="w-4", deadline_date=today + timedelta(days=6), label="Institution sign-off", title="Call w-4",
    )]
    sent = deadline_alert.check_and_send_urgent_deadline_alerts(
        faculty_id="prof-w", reference_date=today, target=_target(7, 3), opportunities=[], personal_deadlines=personal,
    )
    assert len(sent) == 1
    assert sent[0]["personal"] is True and sent[0]["deadline_type"] == "Institution sign-off"
    assert sent[0]["dedupe_key"].startswith("prof-w:w-4:my_deadline_7:")


def test_widening_reminder_days_does_not_repeat_a_sent_reminder():
    due = date(2026, 10, 30)
    opp = _opp("w-5", due)
    first = deadline_alert.check_and_send_urgent_deadline_alerts(
        faculty_id="prof-w", reference_date=due - timedelta(days=2), target=_target(3), opportunities=[opp],
    )
    assert len(first) == 1
    # The user switches to 7-day reminders only; 2 days left now maps to the 7-day window
    again = deadline_alert.check_and_send_urgent_deadline_alerts(
        faculty_id="prof-w", reference_date=due - timedelta(days=2), target=_target(7), opportunities=[opp],
    )
    assert again == []


def test_personal_deadline_on_the_agency_date_is_not_sent_twice():
    due = date(2026, 10, 30)
    personal = [deadline_alert.PersonalDeadline(opportunity_id="w-6", deadline_date=due, label="", title="Call w-6")]
    sent = deadline_alert.check_and_send_urgent_deadline_alerts(
        faculty_id="prof-w", reference_date=due - timedelta(days=2), target=_target(3),
        opportunities=[_opp("w-6", due)], personal_deadlines=personal,
    )
    assert [a["personal"] for a in sent] == [False]


@pytest.mark.parametrize(
    ("stored", "expected"),
    [
        (None, (3,)),
        ([], ()),
        ([7, 3, 3, 14], (3, 7, 14)),
        ([5], (3,)),          # nothing valid: keep the default rather than silently switching off
        (["x"], (3,)),
        ("7", (3,)),
    ],
)
def test_reminder_preference_parsing(stored, expected):
    assert recipients._as_reminder_days(stored) == expected


def test_load_personal_deadlines_skips_untracked_calls():
    client = db.get_client()
    for opp_id in ("p-1", "p-2", "p-3", "p-4"):
        client.table("opportunities").insert({"id": opp_id, "title": f"Call {opp_id}", "agency_or_publisher": "DST"}).execute()
    client.table("user_opportunity_state").insert([
        {"user_id": "u-1", "opportunity_id": "p-1", "status": "pursuing", "my_deadline": "2026-10-05", "my_deadline_label": "Sign-off"},
        {"user_id": "u-1", "opportunity_id": "p-2", "status": "dismissed", "my_deadline": "2026-10-05", "my_deadline_label": ""},
        # Stopped tracking, or a result recorded: their own dates no longer remind
        {"user_id": "u-1", "opportunity_id": "p-3", "status": "new", "my_deadline": "2026-10-06", "my_deadline_label": ""},
        {"user_id": "u-1", "opportunity_id": "p-4", "status": "awarded", "my_deadline": "2026-10-07", "my_deadline_label": ""},
    ]).execute()
    rows = db.load_personal_deadlines("u-1", date(2026, 10, 1), date(2026, 10, 31))
    assert [r["opportunity_id"] for r in rows] == ["p-1"]
    assert rows[0]["deadline_date"] == date(2026, 10, 5) and rows[0]["label"] == "Sign-off"


def test_only_wrong_topic_dismissals_reach_the_scorer():
    """Dismissals for other reasons are stored as 'neutral' and must not penalise scores."""
    db.record_feedback("o-1", "prof-f", "not_relevant", "[dismissed:wrong_topic]", ["marine"])
    db.record_feedback("o-2", "prof-f", "neutral", "[dismissed:not_eligible]", [])
    signals = db.load_feedback_signals(rating="not_relevant", faculty_id="prof-f")
    assert [s["opportunity_id"] for s in signals] == ["o-1"]


def test_institution_deadline_reminds_with_its_own_heading_and_key():
    today = date(2026, 10, 1)
    internal = [deadline_alert.PersonalDeadline(
        opportunity_id="w-7", deadline_date=today + timedelta(days=3), label="Your institution's internal deadline",
        title="Call w-7", kind="institution",
    )]
    sent = deadline_alert.check_and_send_urgent_deadline_alerts(
        faculty_id="prof-w", reference_date=today, target=_target(3), opportunities=[], personal_deadlines=internal,
    )
    assert len(sent) == 1
    assert sent[0]["dedupe_key"].startswith("prof-w:w-7:institution_deadline_3:")


def test_load_institution_deadlines_only_for_calls_being_applied_to():
    client = db.get_client()
    for opp_id in ("i-1", "i-2"):
        client.table("opportunities").insert({"id": opp_id, "title": f"Call {opp_id}", "agency_or_publisher": "ANRF"}).execute()
    client.table("user_opportunity_state").insert([
        {"user_id": "u-9", "opportunity_id": "i-1", "status": "pursuing"},
        {"user_id": "u-9", "opportunity_id": "i-2", "status": "new"},
    ]).execute()
    client.table("institution_call_notes").insert([
        {"institution_key": "coep technological university", "opportunity_id": "i-1", "internal_deadline": "2026-10-10", "note": "", "recommended": True},
        {"institution_key": "coep technological university", "opportunity_id": "i-2", "internal_deadline": "2026-10-11", "note": "", "recommended": True},
    ]).execute()
    rows = db.load_institution_deadlines("u-9", "  COEP   Technological University ", date(2026, 10, 1), date(2026, 10, 31))
    assert [(r["opportunity_id"], r["kind"]) for r in rows] == [("i-1", "institution")]
