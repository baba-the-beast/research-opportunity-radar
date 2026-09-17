"""
Unit test suite for the autonomous Render Keep-Alive / Watchdog Agent.
Tests cold-start recovery, retry policies, SSRF prevention, non-retryable status codes,
and credential sanitization using standard library mocks.
"""

from unittest.mock import patch

from scripts.render_keepalive import (
    EXIT_CONFIG_ERROR,
    EXIT_PERSISTENT_FAILURE,
    EXIT_SUCCESS,
    OUTCOME_COLD_START_RECOVERED,
    OUTCOME_HEALTHY,
    OUTCOME_PERSISTENT_FAILURE,
    OUTCOME_TRANSIENT_RECOVERED,
    run_watchdog,
    sanitize_text,
    validate_target_url,
)


def test_validate_target_url_valid():
    """Verify standard production HTTPS URLs pass validation."""
    valid, err = validate_target_url("https://research-opportunity-radar.onrender.com")
    assert valid is True
    assert err == ""


def test_validate_target_url_rejects_insecure_http_by_default():
    """Verify HTTP is rejected by default to enforce TLS in production."""
    valid, err = validate_target_url("http://research-opportunity-radar.onrender.com")
    assert valid is False
    assert "Insecure HTTP scheme rejected" in err

    # Allowed when explicitly configured for local testing
    valid_local, _ = validate_target_url("http://localhost:3000", allow_insecure_http=True)
    assert valid_local is True


def test_validate_target_url_ssrf_protection():
    """Verify loopback, private subnets, and cloud metadata IPs are rejected."""
    # Loopback
    valid, err = validate_target_url("https://127.0.0.1:8080")
    assert valid is False
    assert "Private or metadata IP" in err or "Loopback host" in err

    # Cloud metadata endpoint (AWS / GCP / Azure 169.254.169.254)
    valid_meta, err_meta = validate_target_url("https://169.254.169.254/latest/meta-data/")
    assert valid_meta is False
    assert "Private or metadata IP" in err_meta

    # Private Class A / C subnets
    valid_priv, err_priv = validate_target_url("https://10.0.1.5:443")
    assert valid_priv is False
    assert "Private or metadata IP" in err_priv


def test_sanitize_text_redacts_credentials():
    """Verify logs redact telegram bot tokens, bearer tokens, and secrets."""
    raw = (
        "Contacting https://api.telegram.org/bot123456789:ABCdefGHI_jklMNO-pqrstu/sendMessage "
        "with header Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 "
        "and query param ?key=super_secret_api_key_xyz"
    )
    sanitized = sanitize_text(raw)
    assert "123456789:ABCdefGHI_jklMNO-pqrstu" not in sanitized
    assert "bot[REDACTED_TOKEN]" in sanitized
    assert "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" not in sanitized
    assert "Bearer [REDACTED]" in sanitized
    assert "super_secret_api_key_xyz" not in sanitized
    assert "key=[REDACTED]" in sanitized


@patch("scripts.render_keepalive.ping_endpoint")
def test_watchdog_healthy_immediate(mock_ping):
    """Test immediate HTTP 200 OK returns HEALTHY on first attempt."""
    mock_ping.return_value = (200, 312.5, None, None)

    exit_code, result = run_watchdog(
        base_url="https://research-opportunity-radar.onrender.com",
        path="/api/health",
        timeout=10.0,
        max_retries=3,
        base_delay=0.01,
        jitter=0.01
    )

    assert exit_code == EXIT_SUCCESS
    assert result.result == OUTCOME_HEALTHY
    assert result.attempts == 1
    assert result.http_status == 200
    assert result.failure_class is None


@patch("scripts.render_keepalive.ping_endpoint")
@patch("time.sleep", return_value=None)
def test_watchdog_cold_start_recovery(mock_sleep, mock_ping):
    """Test cold-start timeout on attempt 1, followed by recovery on attempt 2."""
    mock_ping.side_effect = [
        (None, 35000.0, "Connection timed out", "TIMEOUT"),
        (200, 1850.0, None, None)
    ]

    exit_code, result = run_watchdog(
        base_url="https://research-opportunity-radar.onrender.com",
        path="/api/health",
        timeout=35.0,
        max_retries=3,
        base_delay=0.01,
        jitter=0.01
    )

    assert exit_code == EXIT_SUCCESS
    assert result.result == OUTCOME_COLD_START_RECOVERED
    assert result.attempts == 2
    assert result.http_status == 200
    assert mock_sleep.called


@patch("scripts.render_keepalive.ping_endpoint")
@patch("time.sleep", return_value=None)
def test_watchdog_transient_503_recovery(mock_sleep, mock_ping):
    """Test transient 503 gateway error on attempt 1, followed by recovery on attempt 2."""
    mock_ping.side_effect = [
        (503, 1100.0, "HTTP 503: Service Unavailable", "COLD_START_OR_GATEWAY_ERROR"),
        (200, 420.0, None, None)
    ]

    exit_code, result = run_watchdog(
        base_url="https://research-opportunity-radar.onrender.com",
        path="/api/health",
        timeout=35.0,
        max_retries=3,
        base_delay=0.01,
        jitter=0.01
    )

    assert exit_code == EXIT_SUCCESS
    assert result.result in (OUTCOME_COLD_START_RECOVERED, OUTCOME_TRANSIENT_RECOVERED)
    assert result.attempts == 2
    assert result.http_status == 200


@patch("scripts.render_keepalive.send_alert")
@patch("scripts.render_keepalive.ping_endpoint")
@patch("time.sleep", return_value=None)
def test_watchdog_persistent_failure_alerts(mock_sleep, mock_ping, mock_alert):
    """Test persistent failure across all 3 retries triggers alert and exits with code 1."""
    mock_ping.return_value = (502, 1200.0, "HTTP 502: Bad Gateway", "COLD_START_OR_GATEWAY_ERROR")

    exit_code, result = run_watchdog(
        base_url="https://research-opportunity-radar.onrender.com",
        path="/api/health",
        timeout=35.0,
        max_retries=3,
        base_delay=0.01,
        jitter=0.01,
        alert_on_failure=True
    )

    assert exit_code == EXIT_PERSISTENT_FAILURE
    assert result.result == OUTCOME_PERSISTENT_FAILURE
    assert result.attempts == 3
    assert result.http_status == 502
    assert mock_alert.called
    # Verify alert was called with status 'DOWN'
    alert_kwargs = mock_alert.call_args[1]
    assert alert_kwargs["status"] == "DOWN"
    assert alert_kwargs["attempts"] == 3


@patch("scripts.render_keepalive.ping_endpoint")
def test_watchdog_non_retryable_404_aborts_immediately(mock_ping):
    """Test non-retryable 404 aborts immediately without wasting retries."""
    mock_ping.return_value = (404, 180.0, "HTTP 404: Not Found", "NON_RETRYABLE_HTTP_ERROR")

    exit_code, result = run_watchdog(
        base_url="https://research-opportunity-radar.onrender.com",
        path="/api/invalid_path",
        timeout=10.0,
        max_retries=3,
        base_delay=0.01,
        jitter=0.01,
        alert_on_failure=False
    )

    assert exit_code == EXIT_PERSISTENT_FAILURE
    assert result.result == OUTCOME_PERSISTENT_FAILURE
    assert result.attempts == 1  # Exactly 1 attempt; no retries
    assert result.http_status == 404


def test_watchdog_dry_run_mode():
    """Test dry run mode validates without sending actual network requests."""
    exit_code, result = run_watchdog(
        base_url="https://research-opportunity-radar.onrender.com",
        path="/api/health",
        dry_run=True
    )

    assert exit_code == EXIT_SUCCESS
    assert result.attempts == 0
    assert result.result == OUTCOME_HEALTHY


def test_watchdog_invalid_url_configuration_error():
    """Test unconfigured or invalid URL returns EXIT_CONFIG_ERROR."""
    exit_code, result = run_watchdog(
        base_url="",
        path="/api/health"
    )

    assert exit_code == EXIT_CONFIG_ERROR
    assert result.result == "configuration_error"
