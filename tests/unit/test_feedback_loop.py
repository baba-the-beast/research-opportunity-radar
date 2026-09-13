"""Unit test verifying the feedback loop discount on irrelevant topics."""
import pytest

from radar import config
from radar.db import client as db
from radar.models import FacultyProfile, Opportunity, ProfileTerm
from radar.scoring import component_scorer


@pytest.fixture(autouse=True)
def setup_feedback_env(monkeypatch):
    monkeypatch.setenv("ALLOW_IN_MEMORY_DB", "1")
    config.ALLOW_IN_MEMORY_DB = True
    db._in_memory_client = None
    db._supabase_client = None


def test_feedback_penalty_calculation():
    """Verify compute_feedback_penalty applies correct deduction."""
    negative_signals = [
        {"negative_terms": ["quantum", "cryptography"], "feedback_text": "Not our lab focus"}
    ]

    opp_matching = Opportunity(
        kind="journal",
        title="Quantum Cryptography Protocols in Hardware",
        summary="Novel research in quantum key exchange"
    )
    penalty_matching, reasons = component_scorer.compute_feedback_penalty(
        opp_matching,
        negative_signals
    )
    assert penalty_matching > 0.0
    assert any("quantum" in r or "cryptography" in r for r in reasons)

    opp_clean = Opportunity(
        kind="journal",
        title="Edge Computing and Distributed Sensor Networks",
        summary="Autonomous sensor nodes on edge clusters"
    )
    penalty_clean, reasons_clean = component_scorer.compute_feedback_penalty(
        opp_clean,
        negative_signals
    )
    assert penalty_clean == 0.0
    assert len(reasons_clean) == 0


def test_scoring_with_negative_signals():
    """Verify score_opportunity reduces final score when negative signals are present."""
    profile = FacultyProfile(
        id="prof-1",
        full_name="Dr. Test",
        institution="Test Univ",
        profile_text="Edge computing, IoT, embedded systems"
    )
    terms = [
        ProfileTerm(profile_id="prof-1", term="edge computing", term_type="topic", weight=1.0)
    ]

    opp = Opportunity(
        kind="funding",
        title="Edge Computing for Quantum Cryptography Systems",
        summary="Novel research in quantum computing and edge hardware"
    )

    # Baseline score without negative signals
    res_baseline = component_scorer.score_opportunity(opp, profile, terms, negative_signals=[])

    # Score with negative signal matching quantum
    negative_signals = [
        {"negative_terms": ["quantum", "cryptography"]}
    ]
    res_penalized = component_scorer.score_opportunity(opp, profile, terms, negative_signals=negative_signals)

    assert res_penalized.final_score < res_baseline.final_score
    assert "feedback_penalty" in res_penalized.components
    assert res_penalized.components["feedback_penalty"] > 0.0


def test_feedback_db_storage():
    """Verify recording and loading feedback from database."""
    fid = db.record_feedback(
        opportunity_id="opp-123",
        faculty_id="prof-1",
        rating="not_relevant",
        feedback_text="Outside our discipline",
        negative_terms=["robotics", "swarm"]
    )
    assert fid != ""

    signals = db.load_feedback_signals(rating="not_relevant")
    assert len(signals) >= 1
    found = [s for s in signals if s.get("opportunity_id") == "opp-123"]
    assert len(found) == 1
    assert "robotics" in found[0]["negative_terms"]
