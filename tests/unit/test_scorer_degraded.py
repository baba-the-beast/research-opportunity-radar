from radar.models import FacultyProfile, Opportunity, ProfileTerm
from radar.scoring import component_scorer


def test_scorer_degraded_mode():
    """
    Verifies that when SentenceTransformer is marked degraded in production,
    topic similarity is set to 0.0, scoring_degraded component is 1.0,
    and model_version is 'component-v2-degraded'.
    Crucially, ensures fake constant mock vectors do NOT produce 100% false similarity.
    """
    prof = FacultyProfile(
        id="prof-1",
        full_name="Dr. Test",
        institution="COEP",
        profile_text="Robotics and Edge AI"
    )
    terms = [
        ProfileTerm(profile_id="prof-1", term="robotics", term_type="topic", weight=1.0)
    ]
    opp = Opportunity(
        kind="funding",
        title="Unrelated Medieval Literature Grant",
        summary="Analysis of Chaucerian poetry in 14th century Britain"
    )

    # Set degraded mode
    component_scorer.set_model_degraded(True)
    try:
        res = component_scorer.score_opportunity(opp, prof, terms)
        assert res.components["scoring_degraded"] == 1.0
        assert res.components["topic_similarity"] == 0.0
        assert res.model_version == "component-v2-degraded"
    finally:
        # Reset degraded mode
        component_scorer.set_model_degraded(False)


def test_batch_encoding_prepopulates_embeddings():
    """Verify batch vector encoding populates embeddings across a list of opportunities."""
    opps = [
        Opportunity(kind="journal", title=f"Edge AI Research Paper #{i}", summary="Sensor fusion")
        for i in range(5)
    ]
    for opp in opps:
        assert opp.embedding is None

    component_scorer.encode_opportunities_batch(opps, batch_size=2)

    for opp in opps:
        assert opp.embedding is not None
        assert len(opp.embedding) == 384
