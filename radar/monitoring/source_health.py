"""Catches sources that break quietly.

A scraper whose site was redesigned usually does not crash: it reads a page with no table and
reports "no open calls". Each run records what every source listed; this module compares a run with
the source's recent history and says which sources need a look.
"""
from dataclasses import dataclass

# A source that listed calls in at least this many of its last HISTORY_RUNS runs is expected to list some
HISTORY_RUNS = 3
MIN_NONZERO_RUNS = 2


@dataclass
class SourceStat:
    source_name: str
    listed_count: int
    kept_count: int
    error: str | None = None
    latency_ms: int | None = None


@dataclass
class HealthIssue:
    source_name: str
    kind: str  # "error" or "suddenly_empty"
    message: str


def find_issues(stats: list[SourceStat], history: dict[str, list[int]]) -> list[HealthIssue]:
    """Problems in this run. `history` maps a source to its listed_count on recent runs, newest first
    (this run excluded); a missing entry means no history yet, which never raises an alarm."""
    issues: list[HealthIssue] = []
    for stat in stats:
        if stat.error:
            issues.append(HealthIssue(stat.source_name, "error", f"{stat.source_name} could not be read: {stat.error}"))
            continue
        recent = history.get(stat.source_name, [])[:HISTORY_RUNS]
        if stat.listed_count == 0 and sum(1 for n in recent if n > 0) >= MIN_NONZERO_RUNS:
            usual = max(recent)
            issues.append(HealthIssue(
                stat.source_name, "suddenly_empty",
                f"{stat.source_name} listed no calls, after listing up to {usual} on recent runs. "
                "Its website may have changed: check the source page and the scraper.",
            ))
    return issues


def alert_text(issues: list[HealthIssue]) -> str:
    lines = ["⚠️ **Source check: some sources need a look**", ""]
    lines += [f"- {issue.message}" for issue in issues]
    lines += ["", "Users see fewer calls until this is fixed."]
    return "\n".join(lines)
