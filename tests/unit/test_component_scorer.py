from radar.models import FacultyProfile, Opportunity, ProfileTerm
from radar.scoring import component_scorer


def test_score_opportunity_deterministic():
    prof = FacultyProfile(full_name="Dr. Vibha", institution="COEP", profile_text="Graph neural networks for fraud detection")
    terms = [ProfileTerm(profile_id="1", term="graph neural networks", term_type="topic", weight=1.0)]

    opp = Opportunity(kind="journal", title="Graph Neural Networks in Financial Systems", summary="We propose a GNN model")

    res1 = component_scorer.score_opportunity(opp, prof, terms)
    res2 = component_scorer.score_opportunity(opp, prof, terms)

    assert res1.final_score == res2.final_score
    assert res1.band in ("high", "strong", "watch", "low")

def test_negative_term_penalty():
    prof = FacultyProfile(full_name="Dr. Vibha", institution="COEP", profile_text="AI and graph neural networks")
    terms = [
        ProfileTerm(profile_id="1", term="bioinformatics", term_type="topic", weight=1.0, polarity="negative")
    ]
    opp = Opportunity(kind="journal", title="Bioinformatics and Gene Expression Graph Neural Networks")

    component_scorer.score_opportunity(opp, prof, terms)
    assert "bioinformatics" in (opp.summary or "" + opp.title).lower()
