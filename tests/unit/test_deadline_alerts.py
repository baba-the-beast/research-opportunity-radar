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
