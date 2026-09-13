from unittest.mock import MagicMock, patch

from radar.orchestrator import pipeline


@patch("radar.db.client.get_client")
@patch("radar.sources.openalex_client.search_works")
@patch("radar.sources.crossref_client.search_works")
@patch("radar.sources.grants_gov_client.search_opportunities")
def test_pipeline_dry_run_mocked(mock_grants, mock_cr, mock_oa, mock_get_client):
    mock_client = MagicMock()
    mock_get_client.return_value = mock_client
    mock_client.table().insert().execute.return_value.data = [{"id": "run-123"}]
    mock_client.table().select().limit().execute.return_value.data = [{
        "id": "prof-123",
        "full_name": "Dr. Vibha",
        "institution": "COEP",
        "research_keywords": ["graph neural networks"],
        "profile_text": "GNN and fraud detection",
        "profile_embedding": [0.1] * 384
    }]
    mock_client.table().select().eq().execute.return_value.data = []
    mock_client.table().select().order().limit().execute.return_value.data = []

    mock_oa.return_value = [{"title": "GNN Paper", "id": "W1", "doi": "10.1000/1"}]
    mock_cr.return_value = []
    mock_grants.return_value = []

    summary = pipeline.run_pipeline(dry_run=True)
    assert summary.run_id == "run-123"
    assert summary.status in ("success", "partial_failure")


@patch("radar.notify.telegram.send")
@patch("radar.notify.email_brevo.send")
@patch("radar.db.client.upsert_opportunities")
@patch("radar.db.client.get_client")
@patch("radar.sources.openalex_client.search_works")
@patch("radar.sources.crossref_client.search_works")
@patch("radar.sources.grants_gov_client.search_opportunities")
def test_pipeline_dry_run_skips_database_writes(
    mock_grants, mock_cr, mock_oa, mock_get_client, mock_upsert, mock_email, mock_tg
):
    mock_client = MagicMock()
    mock_get_client.return_value = mock_client
    mock_client.table().insert().execute.return_value.data = [{"id": "run-dry"}]
    mock_client.table().select().limit().execute.return_value.data = [{
        "id": "prof-123",
        "full_name": "Dr. Vibha",
        "institution": "COEP",
        "research_keywords": ["machine learning"],
        "profile_text": "ML research",
        "profile_embedding": [0.1] * 384
    }]
    mock_client.table().select().eq().execute.return_value.data = []
    mock_client.table().select().order().limit().execute.return_value.data = []

    mock_oa.return_value = [{"title": "ML Paper", "id": "W2", "doi": "10.1000/2"}]
    mock_cr.return_value = []
    mock_grants.return_value = []

    summary = pipeline.run_pipeline(dry_run=True, suppress_alerts=False)

    assert summary.status in ("success", "partial_failure")
    mock_upsert.assert_not_called()
    mock_tg.assert_not_called()
    mock_email.assert_not_called()


@patch("radar.notify.telegram.send")
@patch("radar.notify.email_brevo.send")
@patch("radar.db.client.upsert_opportunities")
@patch("radar.db.client.get_client")
@patch("radar.sources.openalex_client.search_works")
@patch("radar.sources.crossref_client.search_works")
@patch("radar.sources.grants_gov_client.search_opportunities")
def test_pipeline_suppress_alerts_writes_db_but_skips_notify(
    mock_grants, mock_cr, mock_oa, mock_get_client, mock_upsert, mock_email, mock_tg
):
    mock_client = MagicMock()
    mock_get_client.return_value = mock_client
    mock_client.table().insert().execute.return_value.data = [{"id": "run-suppress"}]
    mock_client.table().select().limit().execute.return_value.data = [{
        "id": "prof-123",
        "full_name": "Dr. Vibha",
        "institution": "COEP",
        "research_keywords": ["machine learning"],
        "profile_text": "ML research",
        "profile_embedding": [0.1] * 384
    }]
    mock_client.table().select().eq().execute.return_value.data = []
    mock_client.table().select().order().limit().execute.return_value.data = []

    mock_oa.return_value = [{"title": "ML Paper", "id": "W3", "doi": "10.1000/3"}]
    mock_cr.return_value = []
    mock_grants.return_value = []
    mock_upsert.return_value = 1

    summary = pipeline.run_pipeline(dry_run=False, suppress_alerts=True)

    assert summary.status in ("success", "partial_failure")
    mock_upsert.assert_called_once()
    mock_tg.assert_not_called()
    mock_email.assert_not_called()

