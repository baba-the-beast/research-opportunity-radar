"""Weekly digest builder module."""
from datetime import UTC, datetime

from radar.models import Opportunity


def build(opportunities: list[Opportunity], failed_sources: list[dict[str, str]] | None = None) -> str:
    today_str = datetime.now(UTC).strftime("%Y-%m-%d")
    lines = [
        "# Weekly Research Opportunity Digest",
        f"Generated: {today_str} | Research Opportunity Radar",
        ""
    ]

    # Prominently surface failed sources if any occurred during cycle
    if failed_sources:
        lines.extend([
            "> [!WARNING]",
            "> **Observatory Source Ingestion Warnings:**",
            "> Some external intelligence feeds encountered errors during this cycle:"
        ])
        for fs in failed_sources:
            src_name = fs.get("source", "Unknown Source")
            err_reason = fs.get("error", "Request failed")
            lines.append(f"> - **{src_name}**: {err_reason}")
        lines.extend([
            "> Unreached feeds will be automatically retried in the subsequent radar cycle.",
            ""
        ])

    lines.extend([
        "---",
        ""
    ])

    if not opportunities:
        lines.extend([
            "No new high-priority opportunities matching active faculty criteria were discovered in this cycle.",
            ""
        ])
        return "\n".join(lines)

    for idx, opp in enumerate(opportunities, start=1):
        score_info = f"Score: {opp.score_result.final_score:.1f}/100 ({opp.score_result.band.capitalize()})" if opp.score_result else "Score: N/A"
        matched_str = ", ".join(opp.score_result.matched_terms) if opp.score_result and opp.score_result.matched_terms else "Topic match"

        conf_dl = opp.earliest_confirmed_deadline()
        dl_str = conf_dl.strftime("%Y-%m-%d") if conf_dl else "Rolling"

        lines.extend([
            f"### {idx}. {opp.title}",
            f"- **Source:** {opp.primary_source_name or 'Unknown'} · [{opp.primary_source_url}]({opp.primary_source_url})",
            f"- **Relevance:** {score_info} — Overlaps: *{matched_str}*",
            f"- **Deadline:** {dl_str}",
            f"- **Publisher/Venue:** {opp.agency_or_publisher or opp.venue_name or 'N/A'}",
            "",
            "---",
            ""
        ])

    return "\n".join(lines)
