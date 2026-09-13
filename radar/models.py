"""Data models and dataclasses for Research Opportunity Radar."""
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any


@dataclass
class OpportunityDeadline:
    deadline_type: str = "submission"  # submission, letter_of_intent, full_proposal, special_issue, event_start, other
    deadline_date: date | None = None
    timezone: str = "Asia/Kolkata"
    confidence: str = "unknown"  # confirmed, probable, unknown, closed, changed
    raw_text: str | None = None
    id: str | None = None

@dataclass
class OpportunitySource:
    source_name: str
    source_url: str
    external_id: str | None = None
    first_seen_at: datetime | None = None
    last_seen_at: datetime | None = None
    source_id: str | None = None

@dataclass
class ScoreResult:
    final_score: float
    band: str  # high, strong, watch, low, not_eligible
    components: dict[str, float] = field(default_factory=dict)
    matched_terms: list[str] = field(default_factory=list)
    negative_matches: list[str] = field(default_factory=list)
    model_version: str = "component-v1"

    def to_dict(self) -> dict[str, Any]:
        return {
            "model_version": self.model_version,
            "final_score": round(self.final_score, 2),
            "band": self.band,
            "components": {k: round(v, 2) for k, v in self.components.items()},
            "matched_terms": self.matched_terms,
            "negative_matches": self.negative_matches,
            "eligibility": {"status": "unknown" if self.band != "not_eligible" else "ineligible", "confidence": 0.4}
        }

@dataclass
class Opportunity:
    kind: str  # journal, venue, funding
    title: str
    summary: str | None = None
    agency_or_publisher: str | None = None
    venue_name: str | None = None
    doi: str | None = None
    status: str = "unknown"
    fingerprint: str | None = None
    discovered_at: datetime | None = None
    embedding: list[float] | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    id: str | None = None
    deadlines: list[OpportunityDeadline] = field(default_factory=list)
    sources: list[OpportunitySource] = field(default_factory=list)
    source_name: str | None = None
    source_url: str | None = None
    external_id: str | None = None
    score_result: ScoreResult | None = None
    is_new: bool = True

    @property
    def primary_source_url(self) -> str | None:
        if self.source_url:
            return self.source_url
        if self.sources:
            return self.sources[0].source_url
        return None

    @property
    def primary_source_name(self) -> str | None:
        if self.source_name:
            return self.source_name
        if self.sources:
            return self.sources[0].source_name
        return None

    def earliest_confirmed_deadline(self) -> date | None:
        confirmed = [d.deadline_date for d in self.deadlines if d.confidence == "confirmed" and d.deadline_date]
        return min(confirmed) if confirmed else None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "title": self.title,
            "summary": self.summary,
            "agency_or_publisher": self.agency_or_publisher,
            "venue_name": self.venue_name,
            "doi": self.doi,
            "status": self.status,
            "fingerprint": self.fingerprint,
            "primary_source_name": self.primary_source_name,
            "primary_source_url": self.primary_source_url,
            "score": self.score_result.to_dict() if self.score_result else None,
            "deadlines": [
                {
                    "type": d.deadline_type,
                    "date": d.deadline_date.isoformat() if d.deadline_date else None,
                    "confidence": d.confidence,
                    "raw_text": d.raw_text
                }
                for d in self.deadlines
            ],
            "metadata": self.metadata,
            "eligibility_report": self.metadata.get("eligibility_report")
        }

@dataclass
class FacultyProfile:
    full_name: str
    institution: str
    id: str | None = None
    department: str | None = None
    research_keywords: list[str] = field(default_factory=list)
    profile_text: str = ""
    profile_embedding: list[float] | None = None
    min_relevance_band: str = "watch"
    deadline_alert_window_days: int = 30
    alert_frequency: str = "weekly"
    openalex_author_id: str | None = None
    orcid: str | None = None
    career_stage: str = "Assistant Professor"
    phd_year: int | None = 2021
    institution_type: str = "R1 Doctoral University (IHE)"
    citizenship_status: str = "US Citizen or Permanent Resident"

@dataclass
class ProfileTerm:
    profile_id: str
    term: str
    term_type: str  # topic, method, application, venue, funding_theme
    weight: float = 1.0
    polarity: str = "positive"  # positive, negative
    source: str = "manual"
    id: str | None = None

@dataclass
class RunSummary:
    run_id: str
    started_at: datetime
    finished_at: datetime | None = None
    status: str = "running"
    opportunities_found: int = 0
    opportunities_new: int = 0
    errors: list[str] = field(default_factory=list)
