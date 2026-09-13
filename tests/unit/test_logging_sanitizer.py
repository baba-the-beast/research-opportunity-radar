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
