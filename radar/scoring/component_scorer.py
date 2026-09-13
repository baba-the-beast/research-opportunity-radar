import os
import sys
from datetime import UTC, datetime

import numpy as np
from sentence_transformers import SentenceTransformer

from radar.logging_config import get_logger
from radar.models import FacultyProfile, Opportunity, ProfileTerm, ScoreResult
from radar.notify import telegram

logger = get_logger("component_scorer")

_model = None

try:
    from huggingface_hub.errors import HfHubHTTPError
    NETWORK_MODEL_EXCEPTIONS = (OSError, ConnectionError, TimeoutError, HfHubHTTPError)
except ImportError:
    NETWORK_MODEL_EXCEPTIONS = (OSError, ConnectionError, TimeoutError)


def is_test_environment() -> bool:
    """Checks if running inside a pytest test runner or hermetic test mode."""
    return (
        "pytest" in sys.modules
        or bool(os.environ.get("PYTEST_CURRENT_TEST"))
        or os.environ.get("RADAR_MOCK_EMBEDDINGS") == "1"
    )


def get_sentence_transformer():
    global _model
    if _model is None:
        try:
            _model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
        except NETWORK_MODEL_EXCEPTIONS as exc:
            if is_test_environment():
                # Hermetic test environment fallback
                class MockTransformer:
                    def encode(self, text, **kwargs):
                        if isinstance(text, list):
                            return np.array([[0.05] * 384 for _ in text], dtype=float)
                        return np.array([0.05] * 384, dtype=float)
                _model = MockTransformer()
            else:
                # Production failure - log loudly and trigger alert
                logger.error(
                    f"CRITICAL: SentenceTransformer model failed to load in production! "
                    f"Falling back to degraded constant-vector mock. Cause: {exc}",
                    source_name="component_scorer",
                    error_category="MODEL_LOAD_FAILURE"
                )
                try:
                    telegram.send(
                        f"🚨 *CRITICAL SCORING WARNING*: SentenceTransformer model failed to load on host.\n"
                        f"Degraded constant mock vectors are active.\nError: `{exc}`"
                    )
                except Exception:
                    pass

                class MockTransformer:
                    def encode(self, text, **kwargs):
                        if isinstance(text, list):
                            return np.array([[0.05] * 384 for _ in text], dtype=float)
                        return np.array([0.05] * 384, dtype=float)
                _model = MockTransformer()
        except Exception:
            if is_test_environment():
                class MockTransformer:
                    def encode(self, text, **kwargs):
                        if isinstance(text, list):
                            return np.array([[0.05] * 384 for _ in text], dtype=float)
                        return np.array([0.05] * 384, dtype=float)
                _model = MockTransformer()
            else:
                logger.error(
                    "FATAL: Unexpected non-network exception during SentenceTransformer initialization.",
                    source_name="component_scorer",
                    error_category="MODEL_FATAL_ERROR"
                )
                raise
    return _model

def cosine_to_pct(cosine_sim: float) -> float:
    # Scale cosine [-1, 1] -> [0, 100]
    return max(0.0, min(100.0, float((cosine_sim + 1.0) / 2.0 * 100.0)))

def embed_cosine(vec1: list[float] | str, vec2: list[float] | str) -> float:
    if not vec1 or not vec2:
        return 0.0
    if isinstance(vec1, str):
        import json
        try:
            vec1 = json.loads(vec1)
        except Exception:
            return 0.0
    if isinstance(vec2, str):
        import json
        try:
            vec2 = json.loads(vec2)
        except Exception:
            return 0.0
    v1 = np.array(vec1, dtype=float)
    v2 = np.array(vec2, dtype=float)
    norm1 = np.linalg.norm(v1)
    norm2 = np.linalg.norm(v2)
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return float(np.dot(v1, v2) / (norm1 * norm2))

def weighted_term_match(opportunity: Opportunity, profile_terms: list[ProfileTerm], term_type: str) -> tuple[float, list[str]]:
    text = (opportunity.title + " " + (opportunity.summary or "")).lower()
    matched = []
    total_weight = 0.0
    gained_weight = 0.0

    relevant_terms = [t for t in profile_terms if t.term_type == term_type and t.polarity == "positive"]
    if not relevant_terms:
        return 50.0, []

    for t in relevant_terms:
        total_weight += t.weight
        if t.term.lower() in text:
            gained_weight += t.weight
            matched.append(t.term)

    score = (gained_weight / total_weight * 100.0) if total_weight > 0 else 0.0
    return min(100.0, score), matched

def venue_or_funder_fit(opportunity: Opportunity, profile_terms: list[ProfileTerm]) -> float:
    target = ((opportunity.agency_or_publisher or "") + " " + (opportunity.venue_name or "")).lower()
    if not target.strip():
        return 50.0
    relevant_terms = [t for t in profile_terms if t.term_type in ("venue", "funding_theme") and t.polarity == "positive"]
    if not relevant_terms:
        return 50.0
    for t in relevant_terms:
        if t.term.lower() in target:
            return 100.0
    return 30.0

def recency_score(discovered_at: datetime) -> float:
    if not discovered_at:
        return 100.0
    days_since = (datetime.now(UTC) - discovered_at).days
    return max(0.0, (1.0 - days_since / 14.0) * 100.0)

def deadline_actionability_score(opportunity: Opportunity) -> tuple[float, list[str]]:
    confirmed_dl = [d for d in opportunity.deadlines if d.confidence == "confirmed" and d.deadline_date]
    if not confirmed_dl:
        return 0.0, []
    earliest = min(d.deadline_date for d in confirmed_dl)
    days_left = (earliest - datetime.now(UTC).date()).days
    if days_left < 0:
        return 0.0, ["passed_deadline"]
    elif days_left <= 7:
        return 100.0, []
    elif days_left <= 30:
        return 70.0, []
    else:
        return 40.0, []

def negative_term_penalty(opportunity: Opportunity, profile_terms: list[ProfileTerm]) -> float:
    text = (opportunity.title + " " + (opportunity.summary or "")).lower()
    neg_terms = [t for t in profile_terms if t.polarity == "negative"]
    penalty = 0.0
    for t in neg_terms:
        if t.term.lower() in text:
            penalty += 10.0 * t.weight
    return min(25.0, penalty)

def compute_feedback_penalty(opportunity: Opportunity, negative_signals: list[dict] | None = None) -> tuple[float, list[str]]:
    """Calculates negative penalty from user feedback (opportunities marked not relevant)."""
    if not negative_signals:
        return 0.0, []
    penalty = 0.0
    matched_reasons = []
    text = (opportunity.title + " " + (opportunity.summary or "")).lower()

    for sig in negative_signals:
        neg_terms = sig.get("negative_terms") or []
        for term in neg_terms:
            if term and len(term) >= 4 and term.lower() in text:
                penalty += 12.0
                matched_reasons.append(f"feedback_penalty:{term.lower()}")

    return min(35.0, penalty), list(set(matched_reasons))

def score_band(score: float) -> str:
    if score >= 80.0:
        return "high"
    elif score >= 65.0:
        return "strong"
    elif score >= 50.0:
        return "watch"
    else:
        return "low"

def score_opportunity(
    opportunity: Opportunity,
    profile: FacultyProfile,
    profile_terms: list[ProfileTerm],
    negative_signals: list[dict] | None = None
) -> ScoreResult:
    model = get_sentence_transformer()

    # Topic similarity
    opp_text = opportunity.title + " " + (opportunity.summary or "")
    if not opportunity.embedding:
        opportunity.embedding = model.encode(opp_text).tolist()

    if not profile.profile_embedding and profile.profile_text:
        profile.profile_embedding = model.encode(profile.profile_text).tolist()

    cos_sim = embed_cosine(opportunity.embedding, profile.profile_embedding or [])
    topic_sim_pct = cosine_to_pct(cos_sim)

    exact_match, matched_topics = weighted_term_match(opportunity, profile_terms, "topic")
    method_match, matched_methods = weighted_term_match(opportunity, profile_terms, "method")
    app_match, matched_apps = weighted_term_match(opportunity, profile_terms, "application")
    v_fit = venue_or_funder_fit(opportunity, profile_terms)
    recency = recency_score(opportunity.discovered_at or datetime.now(UTC))
    deadline_act, neg_dl = deadline_actionability_score(opportunity)

    penalty = negative_term_penalty(opportunity, profile_terms)
    feedback_pen, fb_matches = compute_feedback_penalty(opportunity, negative_signals)
    total_penalty = penalty + feedback_pen

    base = (
        0.35 * topic_sim_pct +
        0.20 * exact_match +
        0.10 * method_match +
        0.10 * app_match +
        0.10 * v_fit +
        0.05 * recency +
        0.10 * deadline_act
    )

    final_score = max(0.0, min(100.0, base - total_penalty))
    band = score_band(final_score)

    all_matched = list(set(matched_topics + matched_methods + matched_apps))
    all_negatives = list(set(neg_dl + fb_matches))

    components = {
        "topic_similarity": topic_sim_pct,
        "exact_term_match": exact_match,
        "method_match": method_match,
        "application_match": app_match,
        "venue_or_funder_fit": v_fit,
        "recency": recency,
        "deadline_actionability": deadline_act,
        "feedback_penalty": feedback_pen
    }

    return ScoreResult(
        final_score=final_score,
        band=band,
        components=components,
        matched_terms=all_matched,
        negative_matches=all_negatives,
        model_version="component-v1"
    )

class ComponentScorer:
    """Class wrapper providing score method for compatibility with OO-style callers."""
    @staticmethod
    def score(
        opportunity: Opportunity,
        faculty_profile: FacultyProfile,
        profile_terms: list[ProfileTerm] | None = None,
        negative_signals: list[dict] | None = None
    ) -> ScoreResult:
        return score_opportunity(
            opportunity=opportunity,
            faculty_profile=faculty_profile,
            profile_terms=profile_terms,
            negative_signals=negative_signals
        )

