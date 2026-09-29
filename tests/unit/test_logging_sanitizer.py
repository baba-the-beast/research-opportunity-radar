from radar.logging_config import sanitize_log_text


def test_sanitize_log_text_redacts_tokens():
    raw = "Connecting with token: sbp_1234567890abcdef12345678"
    sanitized = sanitize_log_text(raw)
    assert "sbp_1234567890abcdef12345678" not in sanitized
    assert "[REDACTED]" in sanitized


def test_sanitize_log_text_redacts_keys_and_passwords():
    raw = "API call failed with api_key=secretKey123456 and password='SuperSecretPassword!'"
    sanitized = sanitize_log_text(raw)
    assert "secretKey123456" not in sanitized
    assert "SuperSecretPassword!" not in sanitized
    assert "[REDACTED]" in sanitized


def test_telegram_bot_token_in_url_is_redacted():
    from radar.logging_config import sanitize_log_text
    fake = "bot1234567890:AAFakeFakeFakeFakeFakeFakeFakeFake12"
    msg = f"401 Client Error: Unauthorized for url: https://api.telegram.org/{fake}/sendMessage"
    out = sanitize_log_text(msg)
    assert "AAFakeFake" not in out and "1234567890" not in out
    assert "api.telegram.org/[REDACTED]/sendMessage" in out


def test_telegram_http_error_message_has_no_token(monkeypatch):
    from unittest.mock import MagicMock, patch

    import pytest
    import requests

    from radar import config
    from radar.notify import telegram

    monkeypatch.setattr(config, "TELEGRAM_BOT_TOKEN", "1234567890:AAFakeFakeFakeFakeFakeFakeFakeFake12")
    monkeypatch.setattr(config, "TELEGRAM_CHAT_ID", "42")
    resp = MagicMock(status_code=401)
    resp.raise_for_status.side_effect = requests.HTTPError("401 for url: https://api.telegram.org/bot1234567890:AAFake.../x")
    with patch("requests.post", return_value=resp), pytest.raises(requests.HTTPError) as exc:
        telegram.send("hello")
    assert "AAFake" not in str(exc.value) and "401" in str(exc.value)
