"""Scoring behaviour that affects every user: term matching, scaling and missing components."""
from datetime import date

import pytest

from radar.models import FacultyProfile, Opportunity, OpportunityDeadline, ProfileTerm
from radar.scoring import component_scorer as cs


@pytest.fixture(autouse=True)
def frozen_today(monkeypatch):
    monkeypatch.setattr(cs, "today_ist", lambda: date(2026, 9, 29))


def _call(title: str, summary: str = "", deadline: date | None = None, confidence: str = "confirmed") -> Opportunity:
    opp = Opportunity(kind="funding", title=title, summary=summary, agency_or_publisher="ANRF")
    if deadline:
        opp.deadlines.append(OpportunityDeadline(deadline_type="full_proposal", deadline_date=deadline, confidence=confidence))
    return opp


def _term(term: str, term_type: str = "topic", polarity: str = "positive") -> ProfileTerm:
    return ProfileTerm(profile_id="p", term=term, term_type=term_type, weight=1.0, polarity=polarity)


def test_terms_match_whole_words_only():
    assert cs.term_in_text("ai", "ai for science and engineering")
    assert not cs.term_in_text("ai", "national science chair")
    assert not cs.term_in_text("iot", "an idiotic example")
    assert cs.term_in_text("c++", "systems in c++ and rust")


def test_unrelated_text_scores_near_zero_similarity():
    assert cs.cosine_to_pct(0.05) == 0.0
    assert cs.cosine_to_pct(0.65) == 100.0
    assert 40 < cs.cosine_to_pct(0.40) < 60


def test_missing_term_types_are_left_out_not_counted_as_neutral():
    score, matched = cs.weighted_term_match(_call("Edge AI call"), [_term("edge ai")], "method")
    assert score is None and matched == []
    assert cs.venue_or_funder_fit(_call("x"), [_term("edge ai")]) is None


def test_deadline_actionability():
    assert cs.deadline_actionability_score(_call("x", deadline=date(2026, 10, 3)))[0] == 100.0
    assert cs.deadline_actionability_score(_call("x", deadline=date(2026, 10, 20)))[0] == 80.0
    assert cs.deadline_actionability_score(_call("x", deadline=date(2026, 10, 20), confidence="probable"))[0] == 64.0
    assert cs.deadline_actionability_score(_call("x", deadline=date(2026, 3, 1))) == (0.0, ["passed_deadline"])
    rolling = _call("x")
    rolling.metadata["rolling"] = True
    assert cs.deadline_actionability_score(rolling)[0] == 50.0


def test_degraded_mode_can_still_reach_high(monkeypatch):
    monkeypatch.setattr(cs, "is_model_degraded", lambda: True)
    profile = FacultyProfile(full_name="Dr. A", institution="IIT", research_keywords=["edge ai"])
    opp = _call("Call for proposals on Edge AI", "edge ai systems", deadline=date(2026, 10, 3))
    result = cs.score_opportunity(opp, profile, [_term("edge ai")])
    assert result.band == "high"
    assert result.components["method_match"] == cs.NOT_APPLICABLE


def test_component_scorer_wrapper_works():
    profile = FacultyProfile(full_name="Dr. A", institution="IIT", profile_text="edge ai")
    result = cs.ComponentScorer.score(_call("Edge AI call"), faculty_profile=profile)
    assert 0 <= result.final_score <= 100
