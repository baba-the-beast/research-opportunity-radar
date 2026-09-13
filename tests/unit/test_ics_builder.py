from unittest.mock import MagicMock, patch

from radar.calendar import ics_builder


@patch("radar.db.client.get_client")
def test_generate_ics_content(mock_get_client):
    mock_client = MagicMock()
    mock_get_client.return_value = mock_client
    mock_client.table().select().eq().execute.return_value.data = [
        {
            "deadline_date": "2026-10-15",
            "deadline_type": "full_proposal",
            "confidence": "confirmed",
            "opportunities": {
                "title": "SERB Core Grant",
                "kind": "funding",
                "opportunity_sources": [{"source_url": "https://dst.gov.in"}]
            }
        }
    ]

    ics_str = ics_builder.generate_ics_content()
    assert "SERB Core Grant" in ics_str
    assert "20261015" in ics_str
