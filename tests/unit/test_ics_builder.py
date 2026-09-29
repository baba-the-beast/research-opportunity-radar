from datetime import date
from unittest.mock import MagicMock, patch

from radar.calendar import ics_builder


@patch("radar.calendar.ics_builder.today_ist", return_value=date(2026, 9, 29))
@patch("radar.db.client.get_client")
def test_generate_ics_content(mock_get_client, _today):
    mock_client = MagicMock()
    mock_get_client.return_value = mock_client
    mock_client.table().select().in_().execute.return_value.data = [
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


@patch("radar.calendar.ics_builder.today_ist", return_value=date(2026, 9, 29))
@patch("radar.db.client.get_client")
def test_ics_skips_past_deadlines_and_uses_stable_uids(mock_get_client, _today):
    rows = [
        {"opportunity_id": "opp-1", "deadline_date": "2026-10-15", "deadline_type": "full_proposal",
         "opportunities": {"title": "Open call", "opportunity_sources": []}},
        {"opportunity_id": "opp-2", "deadline_date": "2026-03-01", "deadline_type": "full_proposal",
         "opportunities": {"title": "Closed call", "opportunity_sources": []}},
    ]
    mock_get_client.return_value.table().select().in_().execute.return_value.data = rows

    first = ics_builder.generate_ics_content()
    second = ics_builder.generate_ics_content()
    assert "Open call" in first and "Closed call" not in first
    assert "UID:opp-1-full_proposal@research-opportunity-radar" in first
    assert first == second  # regeneration doesn't create new events in subscribers' calendars
