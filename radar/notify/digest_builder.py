"""The digest each user gets after a scan: the new calls that match them, soonest deadline first.

Kept short on purpose (a phone screen on Telegram): at most MAX_CALLS calls, each with when it is
due, why it matches, and anything to check about eligibility. Calls the user is not eligible for
never reach here (their band is "not_eligible", which should_alert() rejects).
"""
from datetime import date

from radar.deadlines.deadline_engine import today_ist
from radar.models import Opportunity

MAX_CALLS = 10


def _when(due: date | None, today: date) -> str:
    if not due:
        return "No deadline published yet"
    days = (due - today).days
    when = "today" if days == 0 else "tomorrow" if days == 1 else f"in {days} days"
    return f"Due {due.strftime('%d %b %Y').lstrip('0')} ({when})"


def _eligibility_note(report: dict | None) -> str | None:
    """A line only when there is something to check; eligible calls stay quiet."""
    if not report or report.get("status") == "ELIGIBLE":
        return None
    summary = str(report.get("summary") or "").strip()
    return summary or None


def build(
    opportunities: list[Opportunity],
    failed_sources: list[dict[str, str]] | None = None,
    faculty_id: str | None = None,
) -> str:
    """Render a digest. Pass faculty_id so each recipient sees their own score and matched terms
    (opp.score_result is the best score across all faculty and would expose other users' terms)."""
    today = today_ist()

    def score_of(opp: Opportunity):
        return opp.profile_scores.get(faculty_id) if faculty_id else opp.score_result

    ranked = sorted(
        opportunities,
        key=lambda o: (o.earliest_confirmed_deadline() or date.max, -(score_of(o).final_score if score_of(o) else 0)),
    )
    shown = ranked[:MAX_CALLS]

    count = len(opportunities)
    lines = [f"# {count} new call{'s' if count != 1 else ''} that match your research", ""]
    if not opportunities:
        lines = ["# No new matching calls this scan", "", "Your feed and deadlines are unchanged.", ""]

    for idx, opp in enumerate(shown, start=1):
        score = score_of(opp)
        funder = opp.agency_or_publisher or opp.venue_name or opp.primary_source_name or ""
        lines.append(f"### {idx}. {opp.title}")
        lines.append(f"- {_when(opp.earliest_confirmed_deadline(), today)}" + (f" · {funder}" if funder else ""))
        if score:
            matched = ", ".join(score.matched_terms[:3]) if score.matched_terms else "your research summary"
            lines.append(f"- Match {score.final_score:.1f}/100: {matched}")
        note = _eligibility_note(score.eligibility_report if score else None)
        if note:
            lines.append(f"- ⚠️ {note}")
        if opp.primary_source_url:
            lines.append(f"- [Official call page]({opp.primary_source_url})")
        lines.append("")

    if count > len(shown):
        lines.extend([f"…and {count - len(shown)} more in your feed.", ""])

    if failed_sources:
        names = ", ".join(dict.fromkeys(fs.get("source", "a source") for fs in failed_sources))
        lines.extend([f"*Not checked this time: {names}. They are tried again on the next scan.*", ""])

    return "\n".join(lines).rstrip() + "\n"
