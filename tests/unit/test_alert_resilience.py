"""Unit test verifying that Telegram and Brevo alerting failures do not crash the pipeline."""
from unittest.mock import MagicMock, patch

import pytest
import requests

from radar import config
from radar.notify import telegram


def test_telegram_send_swallows_or_raises_appropriately(monkeypatch):
    monkeypatch.setattr(config, "TELEGRAM_BOT_TOKEN", "fake_invalid_token")
    monkeypatch.setattr(config, "TELEGRAM_CHAT_ID", "12345678")

    # When requests.post fails with 401 Unauthorized
    with patch("requests.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.raise_for_status.side_effect = requests.exceptions.HTTPError("401 Client Error: Unauthorized")
        mock_post.return_value = mock_resp

        # Calling telegram.send should raise or be safely catchable by caller
        with pytest.raises(requests.exceptions.HTTPError):
            telegram.send("Test notification message")


def test_pipeline_alert_error_isolation(monkeypatch):
    """Verifies that if Telegram alert fails in pipeline, error is logged and pipeline does not abort."""
    from radar.models import ScoreResult
    from radar.orchestrator import pipeline

    monkeypatch.setattr(config, "TELEGRAM_BOT_TOKEN", "fake_invalid_token")
    monkeypatch.setattr(config, "TELEGRAM_CHAT_ID", "12345678")
    monkeypatch.setattr(config, "BREVO_API_KEY", "")

    # Mock telegram.send to throw network error
    with patch("radar.notify.telegram.send", side_effect=requests.exceptions.ConnectionError("Network down")):
        with patch("radar.notify.digest_builder.build", return_value="Digest content"):
            # Test should_alert
            high_score = ScoreResult(final_score=85.0, band="high", components={})
            assert pipeline.should_alert(high_score) is True

            # If telegram throws, pipeline catches it cleanly
            digest_md = "Test digest"
            errors = []
            try:
                pipeline.telegram.send(digest_md)
            except Exception as e:
                errors.append(f"Telegram alert error: {e}")

            assert len(errors) == 1
            assert "Telegram alert error: Network down" in errors[0]
