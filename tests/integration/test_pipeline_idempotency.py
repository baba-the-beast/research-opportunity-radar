from datetime import date
from unittest.mock import patch

import pytest

from radar import config
from radar.db import client as db
from radar.models import Opportunity, OpportunityDeadline, OpportunitySource
from radar.orchestrator import pipeline


@pytest.fixture(autouse=True)
def setup_idempotency_env(monkeypatch):
    monkeypatch.setenv("ALLOW_IN_MEMORY_DB", "1")
    monkeypatch.setenv("OPENALEX_API_KEY", "faculty.test@institution.edu")
    config.ALLOW_IN_MEMORY_DB = True
    # Reset in-memory client
    db._in_memory_client = None
    db._supabase_client = None


def test_pipeline_idempotency_second_run_zero_new():
    """
    Verifies pipeline idempotency:
    Running the pipeline twice against identical data source returns must yield
    strictly 0 new opportunities on the second execution.
    """
    client = db.get_client()

    # Seed faculty profile in in-memory client
    prof_data = {
        "id": "prof-idempotency-1",
        "full_name": "Dr. Vibha Test",
        "institution": "COEP Tech",
        "department": "Computer Engineering",
        "research_keywords": ["sensor fusion", "edge AI"],
        "profile_text": "Edge AI and sensor fusion research",
        "min_relevance_band": "watch",
        "profile_embedding": [0.05] * 384
    }
    client.table("faculty_profile").insert(prof_data)

    client.table("profile_terms").insert([
        {
            "id": "term-1",
            "profile_id": "prof-idempotency-1",
            "term": "sensor fusion",
            "term_type": "topic",
            "weight": 0.9,
            "polarity": "positive"
        },
        {
            "id": "term-2",
            "profile_id": "prof-idempotency-1",
            "term": "edge AI",
            "term_type": "topic",
            "weight": 0.85,
            "polarity": "positive"
        }
    ])

    def fixed_calls(agency_list, errors=None):
        # Fresh objects each run, as a real scan would return
        return [
            Opportunity(
                kind="funding",
                title="Call for proposals: Robust Sensor Fusion for Cyber-Physical Systems",
                summary="ANRF call on sensor fusion and edge AI for cyber-physical systems",
                agency_or_publisher="ANRF",
                status="open",
                source_name="ANRF",
                source_url="https://anrfonline.in/ANRF/sensor_fusion_call",
                deadlines=[OpportunityDeadline(deadline_type="full_proposal", deadline_date=date(2099, 1, 31), confidence="confirmed")],
                sources=[OpportunitySource(source_name="ANRF", source_url="https://anrfonline.in/ANRF/sensor_fusion_call")],
            ),
            Opportunity(
                kind="funding",
                title="Low-Latency Edge AI Inference: Call for Proposals",
                summary="DBT call on edge AI inference",
                agency_or_publisher="DBT",
                status="open",
                source_name="DBT",
                source_url="https://dbt.gov.in/storage/media/edge-ai.pdf",
                deadlines=[OpportunityDeadline(deadline_type="full_proposal", deadline_date=date(2099, 2, 28), confidence="confirmed")],
                sources=[OpportunitySource(source_name="DBT", source_url="https://dbt.gov.in/storage/media/edge-ai.pdf")],
            ),
        ]

    class MockTransformer:
        def encode(self, text, **kwargs):
            import numpy as np
            if isinstance(text, list):
                return np.array([[0.05] * 384 for _ in text], dtype=float)
            return np.array([0.05] * 384, dtype=float)

    with patch("radar.scoring.component_scorer.get_sentence_transformer", return_value=MockTransformer()), \
         patch("radar.orchestrator.pipeline.funding_deadline_scan", side_effect=fixed_calls), \
         patch("radar.sources.pdf_details.enrich_with_pdf_details", return_value=0), \
         patch("radar.agents.discovery_agent.DiscoveryAgent.run_discovery_cycle", return_value=[]):

        # RUN 1
        summary_run1 = pipeline.run_pipeline(dry_run=False)
        assert summary_run1.status in ("success", "partial_failure")
        assert summary_run1.opportunities_found > 0
        assert summary_run1.opportunities_new > 0

        # RUN 2 - Executed with identical inputs
        summary_run2 = pipeline.run_pipeline(dry_run=False)
        assert summary_run2.status in ("success", "partial_failure")
        assert summary_run2.opportunities_found == summary_run1.opportunities_found
        # Idempotency requirement: Exactly 0 new opportunities recorded on re-run
        assert summary_run2.opportunities_new == 0, f"Expected 0 new on re-run, but got {summary_run2.opportunities_new}"
