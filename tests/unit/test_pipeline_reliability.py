"""Pipeline persistence and alerting reliability (in-memory database)."""
from datetime import date

import pytest

from radar import config
from radar.db import client as db
from radar.memory import faculty_profile_store
from radar.models import Opportunity, OpportunityDeadline, OpportunitySource, ScoreResult
from radar.orchestrator.pipeline import should_alert


@pytest.fixture(autouse=True)
def fresh_db():
    db._in_memory_client = None
    yield
    db._in_memory_client = None


def _call(title: str, deadline: date | None, url: str = "https://dbt.gov.in/call.pdf") -> Opportunity:
    opp = Opportunity(
        kind="funding", title=title, agency_or_publisher="DBT", status="open",
        source_name="DBT", source_url=url, fingerprint=f"fp-{title}",
        sources=[OpportunitySource(source_name="DBT", source_url=url)],
    )
    if deadline:
        opp.deadlines.append(OpportunityDeadline(deadline_type="full_proposal", deadline_date=deadline, confidence="confirmed"))
    return opp


@pytest.mark.parametrize("band, min_band, expected", [
    ("high", "high", True),
    ("strong", "high", False),
    ("strong", "strong", True),
    ("watch", "strong", False),
    ("watch", "watch", True),
    ("not_eligible", "low", False),
])
def test_should_alert_respects_minimum_band(band, min_band, expected):
    assert should_alert(ScoreResult(final_score=70, band=band), min_band) is expected


def test_upsert_skips_a_bad_row_and_keeps_the_rest(monkeypatch):
    good, bad = _call("Good call", date(2099, 1, 1)), _call("Bad call", date(2099, 1, 1))
    real = db._upsert_one

    def flaky(client, opp, source_id_for):
        if opp is bad:
            raise RuntimeError("violates check constraint")
        return real(client, opp, source_id_for)

    monkeypatch.setattr(db, "_upsert_one", flaky)
    errors: list[str] = []
    assert db.upsert_opportunities([(bad, "ok"), (good, "ok")], [], errors=errors) == 1
    assert good.id and len(errors) == 1 and "Bad call" in errors[0]


def test_fingerprint_lookup_finds_calls_outside_the_recent_window():
    stored = _call("Old call", date(2099, 1, 1))
    db.upsert_opportunities([(stored, "ok")], [])
    assert db.existing_ids_by_fingerprint(["fp-Old call", "fp-unknown"]) == {"fp-Old call": stored.id}


def test_refresh_replaces_an_extended_deadline():
    stored = _call("Extended call", date(2026, 10, 1))
    db.upsert_opportunities([(stored, "ok")], [])

    seen_again = _call("Extended call", date(2026, 10, 31))
    db.refresh_stored_calls([(stored.id, seen_again)])

    dates = [r["deadline_date"] for r in db.get_client().table("opportunity_deadlines")._rows if r["opportunity_id"] == stored.id]
    assert dates == ["2026-10-31"]


def test_unknown_deadlines_are_not_stored_as_far_future_dates():
    undated = _call("Rolling call", None)
    db.upsert_opportunities([(undated, "ok")], [])
    assert not [r for r in db.get_client().table("opportunity_deadlines")._rows if r["opportunity_id"] == undated.id]


def test_close_expired_opportunities():
    past, ongoing = _call("Past call", date(2026, 3, 1)), _call("Two-stage call", date(2026, 3, 1))
    ongoing.deadlines.append(OpportunityDeadline(deadline_type="letter_of_intent", deadline_date=date(2026, 12, 1), confidence="confirmed"))
    db.upsert_opportunities([(past, "ok"), (ongoing, "ok")], [])

    assert db.close_expired_opportunities(date(2026, 9, 29)) == 1
    status = {r["id"]: r["status"] for r in db.get_client().table("opportunities")._rows}
    assert status[past.id] == "closed" and status[ongoing.id] == "open"


def test_close_expired_reads_past_the_first_page(monkeypatch):
    # PostgREST truncates at max-rows; with a tiny page every expired call must still be found
    monkeypatch.setattr(db, "PAGE_SIZE", 2)
    calls = [_call(f"Past call {i}", date(2026, 3, 1), url=f"https://dbt.gov.in/{i}.pdf") for i in range(5)]
    db.upsert_opportunities([(c, "ok") for c in calls], [])
    assert db.close_expired_opportunities(date(2026, 9, 29)) == 5


def test_deadline_window_query_ignores_discovery_date():
    soon, later = _call("Due soon", date(2026, 10, 1)), _call("Due later", date(2026, 12, 1))
    db.upsert_opportunities([(soon, "ok"), (later, "ok")], [])
    found = db.load_opportunities_with_deadlines_between(date(2026, 9, 29), date(2026, 10, 2))
    assert [o.title for o in found] == ["Due soon"]


def test_digest_alerts_are_recorded_and_not_resent():
    db.record_alerts("fac-1", ["opp-1"], "new_high_relevance", "email")
    assert db.unalerted_opportunity_ids("fac-1", ["opp-1", "opp-2"], "new_high_relevance") == {"opp-2"}
    assert db.unalerted_opportunity_ids("fac-2", ["opp-1"], "new_high_relevance") == {"opp-1"}


def test_demo_profile_is_never_seeded_into_a_real_database(monkeypatch):
    monkeypatch.setattr(config, "ALLOW_IN_MEMORY_DB", False)
    monkeypatch.setattr(faculty_profile_store.db_client, "get_client", lambda: db._InMemoryClient())
    assert faculty_profile_store.get_all_profiles() == []
    assert faculty_profile_store.get_profile_terms("someone-real") == []


def test_preferred_sources_are_attached_and_mapped():
    from radar.models import FacultyProfile
    from radar.orchestrator import pipeline

    db.get_client().table("user_preferences").insert([
        {"user_id": "u-us", "preferred_sources": ["ANRF", "Grants.gov", "NSF", "Bogus"]},
    ])
    us, default = FacultyProfile(full_name="a", institution="x", user_id="u-us"), FacultyProfile(full_name="b", institution="y", user_id="u-new")
    pipeline._attach_preferred_sources([us, default])

    assert us.preferred_sources == ["ANRF", "Grants.gov", "NSF"]  # unknown names dropped
    assert default.preferred_sources is None
    assert pipeline._source_names_for(us) == {"ANRF", "Grants.gov", "NSF Solicitations Feed"}
    assert "WikiCFP" in pipeline._source_names_for(default) and "Grants.gov" not in pipeline._source_names_for(default)
