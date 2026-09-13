from datetime import UTC, datetime, timedelta

from radar.governance import rules
from radar.models import Opportunity, OpportunityDeadline, ScoreResult


def test_missing_source_url_rejected():
    opp = Opportunity(kind="journal", title="No URL Opp", score_result=ScoreResult(final_score=85, band="high"))
    ok, reason = rules.validate_before_alert(opp)
    assert not ok
    assert "missing source_url" in reason

def test_past_deadline_rejected():
    past_date = datetime.now(UTC).date() - timedelta(days=5)
    opp = Opportunity(kind="funding", title="Old Grant", source_url="https://example.com", score_result=ScoreResult(final_score=85, band="high"))
    opp.deadlines.append(OpportunityDeadline(deadline_type="full_proposal", deadline_date=past_date, confidence="confirmed"))

    ok, reason = rules.validate_before_alert(opp)
    assert not ok
    assert "deadline already passed" in reason
