"""Quick rescore: a just-saved profile is scored against the stored catalog without a full scan."""
import pytest

from radar import config
from radar.db import client as db
from radar.models import Opportunity
from radar.orchestrator import rescore


@pytest.fixture(autouse=True)
def in_memory_db(monkeypatch):
    monkeypatch.setenv("ALLOW_IN_MEMORY_DB", "1")
    config.ALLOW_IN_MEMORY_DB = True
    db._in_memory_client = None
    db._supabase_client = None


def test_keywords_only_profile_is_rescored(monkeypatch):
    client = db.get_client()
    client.table("faculty_profile").insert({
        "id": "fp-new", "user_id": "u-new", "full_name": "New User", "institution": "COEP",
        "research_keywords": ["graph neural networks"], "profile_text": "", "profile_embedding": None,
        "created_at": "2026-10-14T00:00:00Z", "updated_at": "2026-10-14T00:00:00Z",
    }).execute()
    catalog = [Opportunity(id="o-1", kind="funding", title="Graph neural networks for materials", agency_or_publisher="ANRF")]
    monkeypatch.setattr(db, "load_recent_opportunities", lambda limit=500: catalog)
    written = []
    monkeypatch.setattr(db, "insert_scores_bulk", lambda rows, chunk_size=500: written.extend(rows))

    assert rescore.run_rescore(user_id="u-new") == 1
    assert [opp_id for opp_id, _ in written] == ["o-1"]
    assert "fp-new" in written[0][1]


def test_nothing_to_do_when_no_profile_is_waiting(monkeypatch):
    monkeypatch.setattr(db, "load_recent_opportunities", lambda limit=500: [])
    assert rescore.run_rescore(user_id="nobody") == 0
