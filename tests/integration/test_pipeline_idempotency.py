from unittest.mock import patch

import pytest

from radar import config
from radar.db import client as db
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

    fixed_works = [
        {
            "id": "W99001",
            "title": "Robust Sensor Fusion in Cyber-Physical Nodes",
            "doi": "https://doi.org/10.1109/TCPS.2025.1001",
            "display_name": "Robust Sensor Fusion in Cyber-Physical Nodes",
            "primary_location": {
                "source": {"display_name": "IEEE Trans CPS", "publisher": "IEEE"}
            }
        },
        {
            "id": "W99002",
            "title": "Low-Latency Edge AI Inference Architecture",
            "doi": "https://doi.org/10.1109/TCPS.2025.1002",
            "display_name": "Low-Latency Edge AI Inference Architecture",
            "primary_location": {
                "source": {"display_name": "ACM Trans Embedded Computing", "publisher": "ACM"}
            }
        }
    ]

    class MockTransformer:
        def encode(self, text, **kwargs):
            import numpy as np
            if isinstance(text, list):
                return np.array([[0.05] * 384 for _ in text], dtype=float)
            return np.array([0.05] * 384, dtype=float)

    with patch("radar.scoring.component_scorer.get_sentence_transformer", return_value=MockTransformer()), \
         patch("radar.sources.openalex_client.search_works", return_value=fixed_works), \
         patch("radar.sources.crossref_client.search_works", return_value=[]), \
         patch("radar.sources.semantic_scholar_client.search_papers", return_value=[]), \
         patch("radar.tools.funding_deadline_scan.funding_deadline_scan", return_value=[]), \
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
