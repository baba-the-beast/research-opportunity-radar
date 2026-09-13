"""relevance_score tool wrapper around component_scorer."""

from radar.models import FacultyProfile, Opportunity, ProfileTerm, ScoreResult
from radar.scoring import component_scorer


def relevance_score(opportunity: Opportunity, faculty_profile: FacultyProfile, profile_terms: list[ProfileTerm] = None) -> ScoreResult:
    """
    Thin wrapper delegating to component_scorer.score_opportunity.
    """
    if profile_terms is None:
        profile_terms = []
    return component_scorer.score_opportunity(opportunity, faculty_profile, profile_terms)
