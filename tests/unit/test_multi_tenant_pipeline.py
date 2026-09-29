"""Per-faculty scoring, feedback isolation, alert dedupe and lock semantics."""
from datetime import date, timedelta
from unittest.mock import MagicMock

import pytest
from postgrest.exceptions import APIError

from radar import config
from radar.db import client as db
from radar.models import FacultyProfile, Opportunity, OpportunityDeadline, ProfileTerm
from radar.notify import deadline_alert
from radar.orchestrator import pipeline


@pytest.fixture(autouse=True)
def in_memory_db(monkeypatch):
    monkeypatch.setenv("ALLOW_IN_MEMORY_DB", "1")
    config.ALLOW_IN_MEMORY_DB = True
    db._in_memory_client = None
    db._supabase_client = None


class _StubEligibility:
    def __init__(self, disqualify: set[str] | None = None):
        self.disqualify = disqualify or set()

    def evaluate_opportunity(self, opp, profile):
        status = "DISQUALIFIED" if profile.id in self.disqualify else "ELIGIBLE"
        report = MagicMock(status=status)
        report.to_dict.return_value = {"status": status, "profile": profile.id}
        return report


def _profile(pid: str, keywords: list[str]) -> FacultyProfile:
    return FacultyProfile(id=pid, full_name=pid, institution="Uni", research_keywords=keywords,
                          profile_text=" ".join(keywords))


def _terms(pid: str, term: str) -> list[ProfileTerm]:
    return [ProfileTerm(profile_id=pid, term=term, term_type="topic", weight=1.0)]


def test_union_keywords_dedupes_case_insensitively():
    profiles = [_profile("a", ["Edge AI", "GNN"]), _profile("b", ["edge ai", "Robotics"])]
    assert pipeline._union_keywords(profiles) == ["Edge AI", "GNN", "Robotics"]


def test_each_profile_gets_its_own_score_and_eligibility(monkeypatch):
    opp = Opportunity(kind="journal", title="Graph neural networks for fraud detection",
                      summary="GNN fraud", source_url="https://x.org/1")
    profiles = [_profile("gnn", ["graph neural networks"]), _profile("bio", ["protein folding"])]
    terms = {"gnn": _terms("gnn", "graph neural networks"), "bio": _terms("bio", "protein folding")}

    pipeline._score_for_profiles([opp], profiles, terms, _StubEligibility(disqualify={"bio"}))

    assert set(opp.profile_scores) == {"gnn", "bio"}
    assert opp.profile_scores["bio"].band == "not_eligible"
    assert opp.profile_scores["gnn"].eligibility_report == {"status": "ELIGIBLE", "profile": "gnn"}
    # Best eligible score drives the opportunity-level governance gate
    assert opp.score_result is opp.profile_scores["gnn"]
    # Per-profile verdicts must not leak into the shared opportunities.metadata
    assert "eligibility_report" not in opp.metadata


def test_opportunity_ineligible_for_everyone_is_dropped_by_governance():
    from radar.governance import rules
    opp = Opportunity(kind="journal", title="Citizens only", source_url="https://x.org/2")
    profiles = [_profile("a", ["x"])]
    pipeline._score_for_profiles([opp], profiles, {"a": _terms("a", "x")}, _StubEligibility(disqualify={"a"}))
    ok, reason = rules.validate_before_alert(opp)
    assert not ok and "disqualified" in reason


def test_insert_scores_writes_one_row_per_faculty():
    opp = Opportunity(kind="journal", title="t", source_url="https://x.org/3")
    profiles = [_profile("p1", ["t"]), _profile("p2", ["t"])]
    pipeline._score_for_profiles([opp], profiles, {"p1": _terms("p1", "t"), "p2": _terms("p2", "t")}, _StubEligibility())
    db.insert_scores("opp-1", opp.profile_scores)

    rows = db.get_client().table("scoring_log")._rows
    assert sorted(r["faculty_id"] for r in rows) == ["p1", "p2"]
    assert rows[0]["components"]["eligibility_report"]["status"] == "ELIGIBLE"


def test_feedback_signals_scoped_to_faculty():
    db.record_feedback("opp-1", "alice", "not_relevant", negative_terms=["robotics"])
    db.record_feedback("opp-2", "bob", "not_relevant", negative_terms=["quantum"])

    alice = db.load_feedback_signals("not_relevant", faculty_id="alice")
    assert [s["faculty_id"] for s in alice] == ["alice"]
    assert len(db.load_feedback_signals("not_relevant")) == 2


def test_urgent_deadline_alerts_dedupe_per_faculty(monkeypatch):
    today = date(2026, 9, 15)
    opp = Opportunity(id="opp-u", kind="funding", title="Urgent", fingerprint="fp-u",
                      deadlines=[OpportunityDeadline(deadline_date=today + timedelta(days=1), confidence="confirmed")])
    monkeypatch.setattr(db, "load_recent_opportunities", lambda limit=500: [opp])

    first = deadline_alert.check_and_send_urgent_deadline_alerts(faculty_id="alice", reference_date=today)
    second = deadline_alert.check_and_send_urgent_deadline_alerts(faculty_id="bob", reference_date=today)
    repeat = deadline_alert.check_and_send_urgent_deadline_alerts(faculty_id="alice", reference_date=today)

    assert len(first) == 1 and len(second) == 1  # both faculty are alerted
    assert repeat == []  # but each only once


def test_urgent_deadline_alerts_respect_opportunity_filter(monkeypatch):
    today = date(2026, 9, 15)
    opp = Opportunity(id="opp-u", kind="funding", title="Urgent", fingerprint="fp-u",
                      deadlines=[OpportunityDeadline(deadline_date=today + timedelta(days=1), confidence="confirmed")])
    monkeypatch.setattr(db, "load_recent_opportunities", lambda limit=500: [opp])

    alerts = deadline_alert.check_and_send_urgent_deadline_alerts(
        faculty_id="alice", reference_date=today, opportunity_ids={"something-else"})
    assert alerts == []


def _postgres_client(insert_error: APIError | None, takeover_rows: list):
    client = MagicMock()
    if insert_error:
        client.table.return_value.insert.return_value.execute.side_effect = insert_error
    client.table.return_value.update.return_value.eq.return_value.lt.return_value.execute.return_value.data = takeover_rows
    return client


def test_postgres_lock_insert_wins(monkeypatch):
    client = _postgres_client(None, [])
    monkeypatch.setattr(db, "get_client", lambda: client)
    assert db.acquire_pipeline_lock("k", "w1") is True
    inserted = client.table.return_value.insert.call_args[0][0]
    assert "locked_at" in inserted and "acquired_at" not in inserted  # schema column name


def test_postgres_lock_held_and_unexpired_is_refused(monkeypatch):
    conflict = APIError({"code": "23505", "message": "duplicate key"})
    monkeypatch.setattr(db, "get_client", lambda: _postgres_client(conflict, []))
    assert db.acquire_pipeline_lock("k", "w2") is False


def test_postgres_lock_expired_lease_is_taken_over(monkeypatch):
    conflict = APIError({"code": "23505", "message": "duplicate key"})
    monkeypatch.setattr(db, "get_client", lambda: _postgres_client(conflict, [{"lock_key": "k"}]))
    assert db.acquire_pipeline_lock("k", "w2") is True


def test_postgres_lock_fails_closed_on_other_errors(monkeypatch):
    broken = APIError({"code": "PGRST204", "message": "column not found"})
    monkeypatch.setattr(db, "get_client", lambda: _postgres_client(broken, []))
    assert db.acquire_pipeline_lock("k", "w1") is False


def test_legacy_dedupe_key_suppresses_realert_for_same_faculty_only(monkeypatch):
    today = date(2026, 9, 15)
    deadline = today + timedelta(days=1)
    opp = Opportunity(id="opp-u", kind="funding", title="Urgent", fingerprint="fp-u",
                      deadlines=[OpportunityDeadline(deadline_date=deadline, confidence="confirmed")])
    monkeypatch.setattr(db, "load_recent_opportunities", lambda limit=500: [opp])
    # Written by the pre-multi-tenant sentinel for the seed profile
    db.get_client().table("alerts_sent").insert({
        "opportunity_id": "opp-u", "faculty_id": "seed",
        "dedupe_key": f"opp-u:deadline_urgent:{deadline.isoformat()}",
    })

    assert deadline_alert.check_and_send_urgent_deadline_alerts(faculty_id="seed", reference_date=today) == []
    assert len(deadline_alert.check_and_send_urgent_deadline_alerts(faculty_id="alice", reference_date=today)) == 1


def test_us_person_status_uses_word_boundaries():
    from radar.agents.eligibility_agent import us_person_status
    assert us_person_status("US Citizen or Permanent Resident") is True
    assert us_person_status("Permanent Resident (Green Card)") is True
    assert us_person_status("Indian Citizen (National / OCI)") is False
    assert us_person_status("Australian citizen") is False  # contains "us" as a substring
    assert us_person_status("citizen") is None  # schema default: ambiguous -> manual review


@pytest.mark.parametrize("status", [
    "Non-US citizen", "Not a U.S. citizen", "Non-U.S. national", "not an American citizen",
    "Latin American", "South American national",
])
def test_us_person_status_negations_and_regional_americans_are_not_us(status):
    from radar.agents.eligibility_agent import us_person_status
    assert us_person_status(status) is False


def test_digest_shows_recipients_own_score_and_terms():
    from radar.models import ScoreResult
    from radar.notify import digest_builder

    opp = Opportunity(kind="journal", title="Shared call", source_url="https://x.org/9")
    opp.profile_scores = {
        "alice": ScoreResult(final_score=92, band="high", matched_terms=["alice-secret-topic"]),
        "bob": ScoreResult(final_score=81, band="high", matched_terms=["graph learning"]),
    }
    opp.score_result = opp.profile_scores["alice"]  # best across profiles

    bob_digest = digest_builder.build([opp], faculty_id="bob")
    assert "81.0/100" in bob_digest and "graph learning" in bob_digest
    assert "92.0" not in bob_digest and "alice-secret-topic" not in bob_digest


def test_public_source_failures_hide_keywords_and_error_text():
    failures = [
        {"source": "journal_watch(alice-private-topic)", "error": "GET https://api.openalex.org/works?search=alice-private-topic timed out"},
        {"source": "journal_watch(other)", "error": "boom"},
        {"source": "Grants.gov / Agency Scans", "error": "503 for https://grants.gov/?q=x"},
    ]
    public = pipeline._public_source_failures(failures)
    rendered = repr(public)
    assert "alice-private-topic" not in rendered and "https://" not in rendered
    assert [f["source"] for f in public] == [
        "Scholarly literature search (OpenAlex / Crossref / Semantic Scholar)",
        "Grants.gov / Agency Scans",
    ]


def test_union_keywords_round_robin_does_not_starve_new_users(monkeypatch):
    monkeypatch.setattr(pipeline, "MAX_SCAN_KEYWORDS", 4)
    veteran = _profile("old", ["a1", "a2", "a3", "a4", "a5"])
    newcomer = _profile("new", ["b1", "b2"])
    assert pipeline._union_keywords([veteran, newcomer]) == ["a1", "b1", "a2", "b2"]


def test_embedding_save_skipped_when_profile_edited_mid_run():
    from radar.memory import faculty_profile_store

    stale = _profile("p1", ["x"])
    stale.profile_text = "t"
    stale.profile_embedding = [0.1, 0.2]
    stale.loaded_updated_at = "2026-09-28T10:00:00+00:00"  # user saved (e.g. new terms) after this

    client = MagicMock()
    update = client.table.return_value.update.return_value
    update.eq.return_value.eq.return_value.execute.return_value.data = []
    import radar.db.client as db_client
    original = db_client.get_client
    db_client.get_client = lambda: client
    try:
        faculty_profile_store.save_profile_embedding(stale)
    finally:
        db_client.get_client = original

    update.eq.assert_called_with("id", "p1")
    update.eq.return_value.eq.assert_called_with("updated_at", "2026-09-28T10:00:00+00:00")


def test_in_memory_update_honours_every_chained_filter():
    table = db.get_client().table("faculty_profile")
    table._rows = [{"id": "p1", "profile_embedding": None, "updated_at": "2026-09-28T10:00:05+00:00"}]

    table.update({"profile_embedding": [1.0]}).eq("id", "p1").eq("updated_at", "2026-09-28T10:00:00+00:00").execute()
    assert table._rows[0]["profile_embedding"] is None  # stale updated_at: no write

    table.update({"profile_embedding": [1.0]}).eq("id", "p1").eq("updated_at", "2026-09-28T10:00:05+00:00").execute()
    assert table._rows[0]["profile_embedding"] == [1.0]


def test_embedding_not_overwritten_after_mid_run_edit_in_memory():
    from radar.memory import faculty_profile_store

    table = db.get_client().table("faculty_profile")
    table._rows = [{"id": "p1", "profile_text": "t", "profile_embedding": None,
                    "updated_at": "2026-09-28T10:00:05+00:00"}]  # user saved after the run loaded it
    stale = _profile("p1", ["x"])
    stale.profile_text = "t"
    stale.profile_embedding = [0.1, 0.2]
    stale.loaded_updated_at = "2026-09-28T10:00:00+00:00"

    faculty_profile_store.save_profile_embedding(stale)
    assert table._rows[0]["profile_embedding"] is None  # stays cleared -> next run rescores


def test_lock_acquire_refuses_on_network_error(monkeypatch):
    import httpx
    client = MagicMock()
    client.table.return_value.insert.return_value.execute.side_effect = httpx.ConnectError("unreachable")
    monkeypatch.setattr(db, "get_client", lambda: client)
    assert db.acquire_pipeline_lock("k", "w1") is False  # refuses instead of raising


def test_lease_renews_while_alive_and_flags_loss():
    import time
    lease = db.PipelineLease("lease_test", locked_by="run-a", ttl_seconds=60, renew_every=0.05)
    assert lease.acquire()
    table = db.get_client().table("pipeline_locks")
    first_expiry = next(r for r in table._rows if r["lock_key"] == "lease_test")["expires_at"]
    time.sleep(0.2)
    renewed_expiry = next(r for r in table._rows if r["lock_key"] == "lease_test")["expires_at"]
    assert renewed_expiry > first_expiry and not lease.lost

    # Another run takes the lease over (e.g. after a long GC pause): renewal must detect it
    next(r for r in table._rows if r["lock_key"] == "lease_test")["locked_by"] = "run-b"
    time.sleep(0.2)
    assert lease.lost
    lease.release()


def test_urgent_alert_not_recorded_when_every_channel_fails(monkeypatch):
    from radar.notify import recipients
    today = date(2026, 9, 15)
    opp = Opportunity(id="opp-f", kind="funding", title="Urgent", fingerprint="fp-f",
                      deadlines=[OpportunityDeadline(deadline_date=today + timedelta(days=1), confidence="confirmed")])
    monkeypatch.setattr(config, "TELEGRAM_BOT_TOKEN", "token")
    monkeypatch.setattr(recipients, "dispatch", lambda target, subject, text: ["Telegram alert error: down"])
    target = recipients.AlertTarget(faculty_id="alice", telegram_chat_id="123")

    errors: list[str] = []
    deadline_alert.check_and_send_urgent_deadline_alerts(
        faculty_id="alice", reference_date=today, target=target, opportunities=[opp], errors=errors)

    assert errors == ["Telegram alert error: down"]
    assert db.get_client().table("alerts_sent")._rows == []  # retried next run

    monkeypatch.setattr(recipients, "dispatch", lambda target, subject, text: [])
    sent = deadline_alert.check_and_send_urgent_deadline_alerts(
        faculty_id="alice", reference_date=today, target=target, opportunities=[opp])
    assert len(sent) == 1 and len(db.get_client().table("alerts_sent")._rows) == 1


def _ics_for(rows, monkeypatch):
    from radar.calendar import ics_builder
    client = MagicMock()
    client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = rows
    monkeypatch.setattr(db, "get_client", lambda: client)
    return ics_builder.generate_ics_content()


def _deadline_row(title, tz):
    return {"deadline_date": "2026-10-15", "deadline_type": "submission", "timezone": tz,
            "opportunities": {"title": title, "opportunity_sources": [{"source_url": "https://x.org"}]}}


def test_ics_labels_each_event_with_its_own_timezone(monkeypatch):
    ics = _ics_for([_deadline_row("India call", "Asia/Kolkata"), _deadline_row("US call", "America/New_York")], monkeypatch)
    unfolded = ics.replace("\r\n ", "")
    # ICS escapes newlines in DESCRIPTION as a literal backslash-n
    assert "Timezone: America/New_York\\n" in unfolded and "America/New_York (IST" not in unfolded
    assert "Asia/Kolkata (IST — Indian Standard Time)" in unfolded
    assert "X-WR-TIMEZONE" not in ics  # mixed zones: no single calendar-wide zone


def test_ics_all_ist_keeps_calendar_timezone(monkeypatch):
    ics = _ics_for([_deadline_row("India call", "Asia/Kolkata"), _deadline_row("Other", None)], monkeypatch)
    assert "X-WR-TIMEZONE:Asia/Kolkata" in ics and "Research Opportunity Radar (IST)" in ics


def test_keyword_scans_recorded_under_neutral_source_name():
    from radar.orchestrator.pipeline import SCHOLARLY_SEARCH_SOURCE
    run_id = db.start_run_log()
    db.start_source_run(run_id, SCHOLARLY_SEARCH_SOURCE)
    names = [r["name"] for r in db.get_client().table("sources")._rows]
    assert names == [SCHOLARLY_SEARCH_SOURCE]
    assert not any("journal_watch(" in n for n in names)


def test_run_log_errors_redacted_before_storage():
    run_id = db.start_run_log()
    leaked = "Telegram alert error: ConnectionError for https://api.telegram.org/bot1234567890:AAFakeFakeFakeFakeFakeFakeFake12/sendMessage"
    db.finish_run_log(run_id, status="partial_failure", errors=[leaked])
    stored = next(r for r in db.get_client().table("run_log")._rows if r["id"] == run_id)["errors"]
    assert "AAFakeFake" not in stored[0] and "[REDACTED]" in stored[0]


def test_telegram_connection_error_has_no_token(monkeypatch):
    from unittest.mock import patch

    import requests

    from radar.notify import telegram
    monkeypatch.setattr(config, "TELEGRAM_BOT_TOKEN", "1234567890:AAFakeFakeFakeFakeFakeFakeFake12")
    monkeypatch.setattr(config, "TELEGRAM_CHAT_ID", "42")
    boom = requests.ConnectionError("Max retries exceeded with url: /bot1234567890:AAFakeFakeFakeFakeFakeFakeFake12/sendMessage")
    with patch("requests.post", side_effect=boom), pytest.raises(requests.RequestException) as exc:
        telegram.send("hi")
    assert "AAFake" not in str(exc.value) and "ConnectionError" in str(exc.value)


def test_alertable_ids_use_latest_score_only():
    log = db.get_client().table("scoring_log")
    log._rows = [
        {"opportunity_id": "o1", "faculty_id": "f", "band": "high", "scored_at": "2026-09-01T00:00:00+00:00"},
        {"opportunity_id": "o1", "faculty_id": "f", "band": "watch", "scored_at": "2026-09-20T00:00:00+00:00"},  # after edit
        {"opportunity_id": "o2", "faculty_id": "f", "band": "watch", "scored_at": "2026-09-01T00:00:00+00:00"},
        {"opportunity_id": "o2", "faculty_id": "f", "band": "strong", "scored_at": "2026-09-20T00:00:00+00:00"},
        {"opportunity_id": "o3", "faculty_id": "other", "band": "high", "scored_at": "2026-09-20T00:00:00+00:00"},
    ]
    assert db.load_alertable_opportunity_ids("f", user_id=None) == {"o2"}
