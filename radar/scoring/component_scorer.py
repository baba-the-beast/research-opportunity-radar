import os
import re
import sys
from datetime import UTC, datetime

import numpy as np
from sentence_transformers import SentenceTransformer

from radar.deadlines.deadline_engine import today_ist
from radar.logging_config import get_logger
from radar.models import FacultyProfile, Opportunity, ProfileTerm, ScoreResult
from radar.notify import telegram

logger = get_logger("component_scorer")

_model = None
_is_degraded = False


def is_model_degraded() -> bool:
    global _is_degraded
    return _is_degraded


def set_model_degraded(val: bool = True):
    global _is_degraded
    _is_degraded = val


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
                # Production failure - log loudly, mark degraded, and alert
                set_model_degraded(True)
                logger.error(
                    f"CRITICAL: SentenceTransformer model failed to load in production! "
                    f"Operating in DEGRADED mode (topic_similarity = 0.0). Cause: {exc}",
                    source_name="component_scorer",
                    error_category="MODEL_LOAD_FAILURE"
                )
                try:
                    telegram.send(
                        f"🚨 *CRITICAL SCORING WARNING*: SentenceTransformer model failed to load on host.\n"
                        f"Scoring is operating in DEGRADED mode.\nError: `{exc}`"
                    )
                except Exception:
                    pass

                class DegradedTransformer:
                    def encode(self, text, **kwargs):
                        if isinstance(text, list):
                            return np.zeros((len(text), 384), dtype=float)
                        return np.zeros(384, dtype=float)
                _model = DegradedTransformer()
        except Exception:
            if is_test_environment():
                class MockTransformer:
                    def encode(self, text, **kwargs):
                        if isinstance(text, list):
                            return np.array([[0.05] * 384 for _ in text], dtype=float)
                        return np.array([0.05] * 384, dtype=float)
                _model = MockTransformer()
            else:
                set_model_degraded(True)
                logger.error(
                    "FATAL: Unexpected non-network exception during SentenceTransformer initialization.",
                    source_name="component_scorer",
                    error_category="MODEL_FATAL_ERROR"
                )
                raise
    return _model

# all-MiniLM-L6-v2 cosine between an unrelated call and a profile is typically 0.0-0.2; a call on
# the faculty member's own topic scores 0.5-0.7. Map that useful band onto 0-100 (the old (c+1)/2
# mapping gave unrelated calls ~55%, inflating every score).
COSINE_FLOOR = 0.15
COSINE_CEILING = 0.65


def cosine_to_pct(cosine_sim: float) -> float:
    return max(0.0, min(100.0, (cosine_sim - COSINE_FLOOR) / (COSINE_CEILING - COSINE_FLOOR) * 100.0))

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

def _opportunity_text(opportunity: Opportunity) -> str:
    return (opportunity.title + " " + (opportunity.summary or "")).lower()


def term_in_text(term: str, text: str) -> bool:
    """Whole-word match, so "ai" does not match "chair" and "iot" does not match "idiot"."""
    term = term.strip().lower()
    if not term:
        return False
    return re.search(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])", text) is not None


def weighted_term_match(opportunity: Opportunity, profile_terms: list[ProfileTerm], term_type: str) -> tuple[float | None, list[str]]:
    """Weighted share of the profile's positive terms of this type found in the call text.
    None when the profile has no terms of this type (the component is left out of the score)."""
    text = _opportunity_text(opportunity)
    relevant_terms = [t for t in profile_terms if t.term_type == term_type and t.polarity == "positive"]
    if not relevant_terms:
        return None, []

    total_weight = sum(t.weight for t in relevant_terms)
    matched = [t.term for t in relevant_terms if term_in_text(t.term, text)]
    gained_weight = sum(t.weight for t in relevant_terms if t.term in matched)
    score = (gained_weight / total_weight * 100.0) if total_weight > 0 else 0.0
    return min(100.0, score), matched


def venue_or_funder_fit(opportunity: Opportunity, profile_terms: list[ProfileTerm]) -> float | None:
    """100 when the funder/venue is one the faculty member listed, 30 otherwise; None if they listed none."""
    relevant_terms = [t for t in profile_terms if t.term_type in ("venue", "funding_theme") and t.polarity == "positive"]
    if not relevant_terms:
        return None
    target = ((opportunity.agency_or_publisher or "") + " " + (opportunity.venue_name or "") + " " + opportunity.title).lower()
    return 100.0 if any(term_in_text(t.term, target) for t in relevant_terms) else 30.0


def recency_score(discovered_at: datetime) -> float:
    if not discovered_at:
        return 100.0
    days_since = (datetime.now(UTC) - discovered_at).days
    return max(0.0, (1.0 - days_since / 14.0) * 100.0)

def deadline_actionability_score(opportunity: Opportunity) -> tuple[float, list[str]]:
    """How actionable the deadline is: soon > later > rolling > unknown. A date read from a document
    ("probable") counts slightly less than one the agency lists in a date column ("confirmed")."""
    dated = [d for d in opportunity.deadlines if d.deadline_date and d.confidence in ("confirmed", "probable")]
    if not dated:
        return (50.0, []) if opportunity.metadata.get("rolling") else (0.0, [])
    upcoming = [d for d in dated if d.deadline_date >= today_ist()]
    if not upcoming:
        return 0.0, ["passed_deadline"]
    nearest = min(upcoming, key=lambda d: d.deadline_date)
    days_left = (nearest.deadline_date - today_ist()).days
    if days_left <= 7:
        score = 100.0
    elif days_left <= 30:
        score = 80.0
    elif days_left <= 90:
        score = 60.0
    else:
        score = 40.0
    return (score if nearest.confidence == "confirmed" else score * 0.8), []


def negative_term_penalty(opportunity: Opportunity, profile_terms: list[ProfileTerm]) -> float:
    text = _opportunity_text(opportunity)
    penalty = 0.0
    for t in profile_terms:
        if t.polarity == "negative" and term_in_text(t.term, text):
            penalty += 10.0 * t.weight
    return min(25.0, penalty)

def compute_feedback_penalty(opportunity: Opportunity, negative_signals: list[dict] | None = None) -> tuple[float, list[str]]:
    """Calculates negative penalty from user feedback (opportunities marked not relevant)."""
    if not negative_signals:
        return 0.0, []
    penalty = 0.0
    matched_reasons = []
    text = _opportunity_text(opportunity)

    for sig in negative_signals:
        neg_terms = sig.get("negative_terms") or []
        for term in neg_terms:
            if term and len(term) >= 4 and term_in_text(term, text):
                penalty += 12.0
                matched_reasons.append(f"feedback_penalty:{term.lower()}")

    return min(35.0, penalty), list(set(matched_reasons))

COMPONENT_WEIGHTS = {
    "topic_similarity": 0.35,
    "exact_term_match": 0.20,
    "method_match": 0.10,
    "application_match": 0.10,
    "venue_or_funder_fit": 0.10,
    "recency": 0.05,
    "deadline_actionability": 0.10,
}
NOT_APPLICABLE = -1.0  # stored in scoring_log components when the profile has no terms of that type


def _or_na(value: float | None) -> float:
    return NOT_APPLICABLE if value is None else value


def score_band(score: float) -> str:
    if score >= 80.0:
        return "high"
    elif score >= 65.0:
        return "strong"
    elif score >= 50.0:
        return "watch"
    else:
        return "low"

def encode_opportunities_batch(opportunities: list[Opportunity], batch_size: int = 32) -> None:
    """
    Batch encodes text for all opportunities lacking embeddings in a single vectorized pass.
    Accelerates ML inference and avoids repeated individual PyTorch tensor operations.
    """
    if is_model_degraded():
        return
    to_encode = [opp for opp in opportunities if not opp.embedding]
    if not to_encode:
        return
    model = get_sentence_transformer()
    if is_model_degraded():
        return
    texts = [f"{opp.title} {opp.summary or ''}" for opp in to_encode]
    try:
        embeddings = model.encode(texts, batch_size=batch_size, show_progress_bar=False)
        for opp, emb in zip(to_encode, embeddings):
            if hasattr(emb, "tolist"):
                opp.embedding = emb.tolist()
            else:
                opp.embedding = list(emb)
    except Exception as e:
        logger.warning(f"Batch embedding failed: {e}. Falling back to per-item embedding.", error_category="BATCH_ENCODE_ERROR")
        for opp, text in zip(to_encode, texts):
            try:
                opp.embedding = model.encode(text).tolist()
            except Exception as item_error:
                logger.warning(f"Embedding failed for '{opp.title[:60]}': {item_error}", error_category="ENCODE_ERROR")


def score_opportunity(
    opportunity: Opportunity,
    profile: FacultyProfile,
    profile_terms: list[ProfileTerm],
    negative_signals: list[dict] | None = None
) -> ScoreResult:
    model = get_sentence_transformer()

    # Topic similarity
    if is_model_degraded():
        topic_sim_pct = 0.0
        model_version = "component-v1-degraded"
    else:
        opp_text = opportunity.title + " " + (opportunity.summary or "")
        if not opportunity.embedding:
            opportunity.embedding = model.encode(opp_text).tolist()

        if not profile.profile_embedding and profile.profile_text:
            profile.profile_embedding = model.encode(profile.profile_text).tolist()

        cos_sim = embed_cosine(opportunity.embedding, profile.profile_embedding or [])
        topic_sim_pct = cosine_to_pct(cos_sim)
        model_version = "component-v1"

    exact_match, matched_topics = weighted_term_match(opportunity, profile_terms, "topic")
    method_match, matched_methods = weighted_term_match(opportunity, profile_terms, "method")
    app_match, matched_apps = weighted_term_match(opportunity, profile_terms, "application")
    v_fit = venue_or_funder_fit(opportunity, profile_terms)
    recency = recency_score(opportunity.discovered_at or datetime.now(UTC))
    deadline_act, neg_dl = deadline_actionability_score(opportunity)

    penalty = negative_term_penalty(opportunity, profile_terms)
    feedback_pen, fb_matches = compute_feedback_penalty(opportunity, negative_signals)
    total_penalty = penalty + feedback_pen

    # Weighted average over the components that apply: a profile without method terms, or a run
    # with the embedding model down, is scored on what is known instead of counting it as 0 or 50.
    weighted = [
        (COMPONENT_WEIGHTS["topic_similarity"], None if is_model_degraded() else topic_sim_pct),
        (COMPONENT_WEIGHTS["exact_term_match"], exact_match),
        (COMPONENT_WEIGHTS["method_match"], method_match),
        (COMPONENT_WEIGHTS["application_match"], app_match),
        (COMPONENT_WEIGHTS["venue_or_funder_fit"], v_fit),
        (COMPONENT_WEIGHTS["recency"], recency),
        (COMPONENT_WEIGHTS["deadline_actionability"], deadline_act),
    ]
    applicable = [(w, v) for w, v in weighted if v is not None]
    base = sum(w * v for w, v in applicable) / sum(w for w, _ in applicable)

    final_score = max(0.0, min(100.0, base - total_penalty))
    band = score_band(final_score)

    all_matched = list(set(matched_topics + matched_methods + matched_apps))
    all_negatives = list(set(neg_dl + fb_matches))

    components = {
        "topic_similarity": topic_sim_pct,
        "exact_term_match": _or_na(exact_match),
        "method_match": _or_na(method_match),
        "application_match": _or_na(app_match),
        "venue_or_funder_fit": _or_na(v_fit),
        "recency": recency,
        "deadline_actionability": deadline_act,
        "feedback_penalty": feedback_pen,
        "scoring_degraded": 1.0 if is_model_degraded() else 0.0
    }

    return ScoreResult(
        final_score=final_score,
        band=band,
        components=components,
        matched_terms=all_matched,
        negative_matches=all_negatives,
        model_version=model_version
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
            profile=faculty_profile,
            profile_terms=profile_terms or [],
            negative_signals=negative_signals
        )

