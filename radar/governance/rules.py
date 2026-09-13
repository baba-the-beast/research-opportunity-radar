"""Governance validation rules module."""
import math
from datetime import UTC, datetime

from radar.models import Opportunity


def validate_before_alert(opp: Opportunity) -> tuple[bool, str | None]:
    if not opp.primary_source_url:
        return False, f"dropped '{opp.title[:60]}': missing source_url"
    if opp.score_result is None or math.isnan(opp.score_result.final_score):
        return False, f"dropped '{opp.title[:60]}': invalid score"
    if opp.kind == "funding":
        confirmed_deadline = opp.earliest_confirmed_deadline()
        if confirmed_deadline and confirmed_deadline < datetime.now(UTC).date():
            return False, f"dropped '{opp.title[:60]}': deadline already passed"

    # Eligibility Gatekeeper validation
    eligibility = opp.metadata.get("eligibility_report")
    if eligibility and eligibility.get("status") == "DISQUALIFIED":
        return False, f"dropped '{opp.title[:60]}': disqualified by eligibility gatekeeper ({eligibility.get('summary', 'criteria mismatch')})"

    return True, None
