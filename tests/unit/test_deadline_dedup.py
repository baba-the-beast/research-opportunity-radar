from datetime import date

import pytest

from radar import config
from radar.db import client as db
from radar.models import Opportunity, OpportunityDeadline


@pytest.fixture(autouse=True)
def setup_dedup_env(monkeypatch):
    monkeypatch.setenv("ALLOW_IN_MEMORY_DB", "1")
    config.ALLOW_IN_MEMORY_DB = True
    db._in_memory_client = None
    db._supabase_client = None


def test_deadline_deduplication_on_repeated_upsert():
    """
    Verifies that calling upsert_opportunities repeatedly with identical
    deadlines does not produce duplicate rows in opportunity_deadlines table.
    """
    client = db.get_client()

    opp = Opportunity(
        kind="funding",
        title="NSF Cyber-Physical Systems 2026",
        summary="Novel sensing architectures",
        fingerprint="fp-test-dedup-12345"
    )
    dl = OpportunityDeadline(
        deadline_type="full_proposal",
        deadline_date=date(2026, 11, 15),
        confidence="confirmed",
        raw_text="Full proposals due November 15, 2026"
    )
    opp.deadlines.append(dl)

    # First upsert
    db.upsert_opportunities(accepted=[(opp, "accepted")], provenance_updates=[])
    deadlines_1 = client.table("opportunity_deadlines").select("*").execute().data
    assert len(deadlines_1) == 1
    assert deadlines_1[0]["deadline_date"] == "2026-11-15"

    # Second upsert with same opportunity and deadline
    db.upsert_opportunities(accepted=[(opp, "accepted")], provenance_updates=[])
    deadlines_2 = client.table("opportunity_deadlines").select("*").execute().data
    # Must still have strictly 1 deadline row, not 2
    assert len(deadlines_2) == 1, f"Expected 1 deadline row after repeated upsert, found {len(deadlines_2)}"
