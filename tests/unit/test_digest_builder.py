"""The per-user digest: short, soonest deadline first, with what to check about eligibility."""
from datetime import date, timedelta

from radar.models import Opportunity, OpportunityDeadline, ScoreResult
from radar.notify import digest_builder

TODAY = date(2026, 10, 13)


def _opp(title: str, days: int | None, score: float = 80, report: dict | None = None) -> Opportunity:
    opp = Opportunity(kind="funding", title=title, agency_or_publisher="ANRF", source_url=f"https://x.in/{title}")
    if days is not None:
        opp.deadlines.append(OpportunityDeadline(deadline_type="full_proposal", deadline_date=TODAY + timedelta(days=days), confidence="confirmed"))
    opp.profile_scores = {"me": ScoreResult(final_score=score, band="high", matched_terms=["graph learning"], eligibility_report=report)}
    return opp


def test_soonest_deadline_first_and_undated_last(monkeypatch):
    monkeypatch.setattr(digest_builder, "today_ist", lambda: TODAY)
    md = digest_builder.build([_opp("Later", 40), _opp("Undated", None), _opp("Soon", 5)], faculty_id="me")
    assert md.index("Soon") < md.index("Later") < md.index("Undated")
    assert "Due 18 Oct 2026 (in 5 days)" in md
    assert "No deadline published yet" in md
    assert md.startswith("# 3 new calls that match your research")


def test_eligibility_note_only_when_there_is_something_to_check(monkeypatch):
    monkeypatch.setattr(digest_builder, "today_ist", lambda: TODAY)
    check = {"status": "NEEDS_MANUAL_REVIEW", "summary": "Check before applying: only for SC/ST researchers."}
    ok = {"status": "ELIGIBLE", "summary": "No eligibility barrier found in the call text."}
    md = digest_builder.build([_opp("Reserved", 10, report=check), _opp("Open", 12, report=ok)], faculty_id="me")
    assert "⚠️ Check before applying: only for SC/ST researchers." in md
    assert "No eligibility barrier" not in md


def test_long_digests_are_capped():
    md = digest_builder.build([_opp(f"Call {i}", i + 1) for i in range(14)], faculty_id="me")
    assert md.count("### ") == digest_builder.MAX_CALLS
    assert "…and 4 more in your feed." in md
