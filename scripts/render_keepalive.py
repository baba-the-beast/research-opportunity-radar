#!/usr/bin/env python3
"""
Autonomous Render Keep-Alive / Watchdog Agent
==============================================
A lightweight, fault-tolerant, standalone reliability agent designed to run
outside Render (e.g., in GitHub Actions).

Core Objectives:
1. Periodically ping Render's lightweight /api/health endpoint to prevent
   inactivity-based container idling (Render free/starter sleep threshold: 15 min).
2. Distinguish cold starts from genuine persistent outages using cold-start-tolerant
   initial timeouts and bounded exponential backoff with jitter.
3. Classify outcomes (HEALTHY, COLD_START_RECOVERED, TRANSIENT_RECOVERED, PERSISTENT_FAILURE, CONFIGURATION_ERROR).
4. Send notifications on persistent failure without spamming on transient glitches.
5. Strict SSRF protection, URL validation, and secret-safe log sanitization.
6. Zero external dependencies: 100% Python standard library.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import random
import re
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any

# Exit Codes
EXIT_SUCCESS = 0
EXIT_PERSISTENT_FAILURE = 1
EXIT_CONFIG_ERROR = 2
EXIT_UNEXPECTED_ERROR = 3

# Outcomes
OUTCOME_HEALTHY = "healthy"
OUTCOME_COLD_START_RECOVERED = "cold_start_recovered"
OUTCOME_TRANSIENT_RECOVERED = "transient_recovered"
OUTCOME_PERSISTENT_FAILURE = "persistent_failure"
OUTCOME_CONFIG_ERROR = "configuration_error"

# Retryable HTTP status codes
RETRYABLE_STATUS_CODES = {502, 503, 504}
# Non-retryable HTTP status codes (immediate fatal application or routing error)
NON_RETRYABLE_STATUS_CODES = {400, 401, 403, 404, 405, 410}


@dataclass
class WatchdogResult:
    target: str
    url: str
    endpoint: str
    attempts: int
    http_status: int | None
    latency_ms: float
    result: str
    failure_class: str | None
    timestamp: str
    error_message: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def sanitize_text(text: str) -> str:
    """Masks potential tokens, bot secrets, passwords, or credentials in log output."""
    if not text:
        return ""
    # Redact Telegram bot tokens (bot<digits>:<alphanumeric>)
    text = re.sub(r"bot\d+:[A-Za-z0-9_-]+", "bot[REDACTED_TOKEN]", text)
    # Redact authorization bearer tokens
    text = re.sub(r"(Bearer\s+)[A-Za-z0-9_.\-]+", r"\1[REDACTED]", text, flags=re.IGNORECASE)
    # Redact secret headers or query params
    text = re.sub(r"(secret|token|password|key)=([^&\s]+)", r"\1=[REDACTED]", text, flags=re.IGNORECASE)
    return text


def log(msg: str, verbose: bool = False, is_verbose_msg: bool = False) -> None:
    """Timestamped log writer with credential sanitization."""
    if is_verbose_msg and not verbose:
        return
    now_iso = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    sanitized = sanitize_text(msg)
    print(f"[{now_iso}] {sanitized}", flush=True)


def is_private_or_reserved_ip(ip_str: str) -> bool:
    """Checks if an IP address is private, loopback, link-local, or cloud metadata."""
    try:
        ip = ipaddress.ip_address(ip_str)
        return (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or str(ip) in {"0.0.0.0", "169.254.169.254"}
        )
    except ValueError:
        return False


def validate_target_url(raw_url: str, allow_insecure_http: bool = False) -> tuple[bool, str]:
    """
    Validates scheme, host, and SSRF restrictions.
    Requires HTTPS for production targets.
    Rejects private IPs, loopback addresses, AWS/GCP metadata endpoints, and dangerous schemes.
    """
    if not raw_url or not raw_url.strip():
        return False, "Target URL is empty or unconfigured."

    raw_url = raw_url.strip()

    try:
        parsed = urllib.parse.urlparse(raw_url)
    except Exception as exc:
        return False, f"Malformed URL: {exc}"

    # Validate scheme
    if parsed.scheme.lower() not in {"http", "https"}:
        return False, f"Invalid scheme '{parsed.scheme}'. Only HTTP/HTTPS permitted."

    if parsed.scheme.lower() != "https" and not allow_insecure_http:
        return False, "Insecure HTTP scheme rejected for production watchdog. Use HTTPS or set --allow-insecure-http."

    host = parsed.hostname
    if not host:
        return False, "Target URL does not contain a valid hostname."

    # Check for localhost / loopback explicitly unless testing with allow_insecure_http
    if host.lower() in {"localhost", "127.0.0.1", "::1"} and not allow_insecure_http:
        return False, f"Loopback host '{host}' rejected for remote watchdog target."

    # Resolve IP and verify not an internal private subnet or metadata endpoint (SSRF guard)
    if not allow_insecure_http:
        try:
            # Check if host is already an IP literal
            if is_private_or_reserved_ip(host):
                return False, f"Private or metadata IP '{host}' rejected for watchdog target."
            # Resolve DNS
            addr_info = socket.getaddrinfo(host, None)
            for addr in addr_info:
                ip_resolved = addr[4][0]
                if is_private_or_reserved_ip(ip_resolved):
                    return False, f"Hostname '{host}' resolves to restricted IP '{ip_resolved}'. SSRF protection triggered."
        except socket.gaierror:
            # If DNS fails to resolve during validation, allow retry logic to handle standard network retries
            pass

    return True, ""


def build_request_url(base_url: str, path: str) -> str:
    """Safely merges base URL and endpoint path."""
    base = base_url.rstrip("/")
    p = path.strip()
    if not p.startswith("/"):
        p = "/" + p
    return base + p


def calculate_backoff(attempt: int, base_delay: float, jitter: float, max_delay: float = 30.0) -> float:
    """Calculates exponential backoff with randomized jitter: base * 2^(attempt-1) + jitter."""
    exp_factor = 2 ** max(0, attempt - 1)
    computed = (base_delay * exp_factor) + random.uniform(0.1, jitter)
    return min(max_delay, computed)


def send_alert(
    target_url: str,
    endpoint: str,
    status: str,
    attempts: int,
    last_http_status: int | None,
    last_error: str,
    latency_ms: float,
    bot_token: str | None = None,
    chat_id: str | None = None
) -> bool:
    """
    Dispatches failure notification to configured alert channels (e.g., Telegram).
    Never prints tokens to logs.
    """
    token = bot_token or os.environ.get("KEEPALIVE_ALERT_TELEGRAM_TOKEN") or os.environ.get("TELEGRAM_BOT_TOKEN")
    cid = chat_id or os.environ.get("KEEPALIVE_ALERT_TELEGRAM_CHAT_ID") or os.environ.get("TELEGRAM_CHAT_ID")

    if not token or not cid:
        log("No alert credentials configured (KEEPALIVE_ALERT_TELEGRAM_TOKEN / CHAT_ID unset). Skipping alert dispatch.")
        return False

    now_iso = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%SZ")
    status_str = f"{last_http_status}" if last_http_status else "N/A"

    msg = (
        f"🚨 *Render Keep-Alive Watchdog Alert*\n\n"
        f"*Target:* `{target_url}`\n"
        f"*Endpoint:* `{endpoint}`\n"
        f"*Status:* *{status}*\n"
        f"*Attempts Exhausted:* `{attempts}`\n"
        f"*Last HTTP Status:* `{status_str}`\n"
        f"*Last Error:* `{sanitize_text(last_error)[:200]}`\n"
        f"*Latency:* `{latency_ms:.0f} ms`\n"
        f"*Timestamp:* `{now_iso}`\n\n"
        f"⚠️ *Action Required*: The Render service did not respond within cold-start and retry boundaries."
    )

    telegram_api_url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = json.dumps({
        "chat_id": cid,
        "text": msg,
        "parse_mode": "Markdown"
    }).encode("utf-8")

    req = urllib.request.Request(
        telegram_api_url,
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "Render-KeepAlive-Watchdog/1.0"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=10.0) as resp:
            if resp.status == 200:
                log("Alert dispatched successfully via Telegram.")
                return True
            log(f"Alert dispatch returned HTTP {resp.status}.")
            return False
    except Exception as e:
        log(f"Failed to dispatch Telegram alert: {sanitize_text(str(e))}")
        return False


def ping_endpoint(url: str, timeout_seconds: float) -> tuple[int | None, float, str | None, str | None]:
    """
    Sends a single HTTP GET request to the target health endpoint.
    Returns (status_code, latency_ms, error_message, failure_class).
    """
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Render-KeepAlive-Watchdog/1.0 (+https://github.com)",
            "Accept": "application/json, text/plain, */*"
        },
        method="GET"
    )

    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
            latency_ms = (time.perf_counter() - t0) * 1000.0
            status = resp.status
            # Read small payload if present
            content = resp.read(1024).decode("utf-8", errors="replace")
            # Verify JSON status if application returned JSON
            if content.strip().startswith("{"):
                try:
                    data = json.loads(content)
                    if data.get("status") not in ("ok", "alive", "healthy", "up"):
                        return status, latency_ms, f"Unexpected body payload: status='{data.get('status')}'", "UNEXPECTED_BODY"
                except json.JSONDecodeError:
                    pass
            return status, latency_ms, None, None

    except urllib.error.HTTPError as he:
        latency_ms = (time.perf_counter() - t0) * 1000.0
        err_msg = f"HTTP {he.code}: {he.reason}"
        fail_class = "HTTP_ERROR"
        if he.code in RETRYABLE_STATUS_CODES:
            fail_class = "COLD_START_OR_GATEWAY_ERROR"
        elif he.code in NON_RETRYABLE_STATUS_CODES:
            fail_class = "NON_RETRYABLE_HTTP_ERROR"
        return he.code, latency_ms, err_msg, fail_class

    except (urllib.error.URLError, TimeoutError) as ue:
        latency_ms = (time.perf_counter() - t0) * 1000.0
        reason = getattr(ue, "reason", ue)
        is_timeout = isinstance(reason, (socket.timeout, TimeoutError)) or "timed out" in str(reason).lower()
        fail_class = "TIMEOUT" if is_timeout else "NETWORK_ERROR"
        return None, latency_ms, f"Connection failed: {reason}", fail_class

    except Exception as e:
        latency_ms = (time.perf_counter() - t0) * 1000.0
        return None, latency_ms, f"Unexpected error: {str(e)}", "UNEXPECTED_ERROR"


def run_watchdog(
    base_url: str,
    path: str = "/api/health",
    timeout: float = 35.0,
    max_retries: int = 3,
    base_delay: float = 3.0,
    jitter: float = 1.0,
    dry_run: bool = False,
    verbose: bool = False,
    allow_insecure_http: bool = False,
    alert_on_failure: bool = True,
    bot_token: str | None = None,
    chat_id: str | None = None
) -> tuple[int, WatchdogResult]:
    """
    Executes the full watchdog check cycle:
    1. Validates target URL
    2. Executes bounded retries with exponential backoff & jitter
    3. Handles cold starts
    4. Categorizes result
    5. Dispatches alerts if persistently down
    6. Returns (exit_code, WatchdogResult)
    """
    timestamp = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

    log("Render Keep-Alive Watchdog Agent started.")

    # 1. Validation
    is_valid, val_err = validate_target_url(base_url, allow_insecure_http=allow_insecure_http)
    if not is_valid:
        log(f"Configuration Error: {val_err}")
        result = WatchdogResult(
            target="render",
            url=base_url or "UNCONFIGURED",
            endpoint=path,
            attempts=0,
            http_status=None,
            latency_ms=0.0,
            result=OUTCOME_CONFIG_ERROR,
            failure_class="INVALID_CONFIGURATION",
            timestamp=timestamp,
            error_message=val_err
        )
        return EXIT_CONFIG_ERROR, result

    full_url = build_request_url(base_url, path)
    log(f"Watchdog Target: {sanitize_text(full_url)}")
    log(f"Policy: max_retries={max_retries}, cold_start_timeout={timeout}s, base_delay={base_delay}s", verbose=verbose, is_verbose_msg=True)

    if dry_run:
        log("[DRY RUN] Configuration validated. Skipping actual HTTP transmission.")
        result = WatchdogResult(
            target="render",
            url=full_url,
            endpoint=path,
            attempts=0,
            http_status=200,
            latency_ms=0.0,
            result=OUTCOME_HEALTHY,
            failure_class=None,
            timestamp=timestamp,
            error_message="Dry run: validation passed without request"
        )
        return EXIT_SUCCESS, result

    # 2. Execution Loop
    attempt = 0
    had_cold_start_delay = False
    last_status: int | None = None
    last_latency = 0.0
    last_error: str | None = None
    last_fail_class: str | None = None

    while attempt < max_retries:
        attempt += 1
        log(f"Attempt {attempt}/{max_retries}: GET {sanitize_text(full_url)} (timeout={timeout}s)...")

        status, latency_ms, err_msg, fail_class = ping_endpoint(full_url, timeout_seconds=timeout)
        last_status = status
        last_latency = latency_ms
        last_error = err_msg
        last_fail_class = fail_class

        if status == 200 and not err_msg:
            # Succeeded! Determine if this was immediate healthy or recovered
            if attempt == 1:
                outcome = OUTCOME_HEALTHY
                log(f"HTTP 200 OK — Latency: {latency_ms:.0f} ms. Service is ACTIVE & HEALTHY.")
            elif had_cold_start_delay:
                outcome = OUTCOME_COLD_START_RECOVERED
                log(f"HTTP 200 OK — Latency: {latency_ms:.0f} ms. Service WOKE UP and RECOVERED from cold start.")
            else:
                outcome = OUTCOME_TRANSIENT_RECOVERED
                log(f"HTTP 200 OK — Latency: {latency_ms:.0f} ms. Service RECOVERED after retry.")

            result = WatchdogResult(
                target="render",
                url=full_url,
                endpoint=path,
                attempts=attempt,
                http_status=status,
                latency_ms=round(latency_ms, 2),
                result=outcome,
                failure_class=None,
                timestamp=timestamp
            )
            return EXIT_SUCCESS, result

        # Encountered failure on this attempt
        log(f"Attempt {attempt} failed: {sanitize_text(err_msg or 'Unknown error')} (latency: {latency_ms:.0f} ms)")

        if fail_class in ("TIMEOUT", "COLD_START_OR_GATEWAY_ERROR"):
            had_cold_start_delay = True

        # Check if non-retryable error
        if fail_class == "NON_RETRYABLE_HTTP_ERROR":
            log(f"Encountered non-retryable HTTP status ({status}). Aborting retries immediately.")
            break

        # Check if we should retry
        if attempt < max_retries:
            delay = calculate_backoff(attempt, base_delay=base_delay, jitter=jitter)
            log(f"Backing off for {delay:.2f}s before attempt {attempt + 1}...")
            time.sleep(delay)

    # 3. Persistent Failure reached
    log(f"CRITICAL: Service failed {attempt} check(s). Last status: {last_status}, Last error: {sanitize_text(last_error or 'None')}")

    if alert_on_failure:
        send_alert(
            target_url=full_url,
            endpoint=path,
            status="DOWN",
            attempts=attempt,
            last_http_status=last_status,
            last_error=last_error or "Unknown failure",
            latency_ms=last_latency,
            bot_token=bot_token,
            chat_id=chat_id
        )

    result = WatchdogResult(
        target="render",
        url=full_url,
        endpoint=path,
        attempts=attempt,
        http_status=last_status,
        latency_ms=round(last_latency, 2),
        result=OUTCOME_PERSISTENT_FAILURE,
        failure_class=last_fail_class or "EXHAUSTED_RETRIES",
        timestamp=timestamp,
        error_message=last_error
    )
    return EXIT_PERSISTENT_FAILURE, result


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Autonomous Render Keep-Alive / Reliability Watchdog Agent."
    )
    parser.add_argument(
        "--url",
        default=os.environ.get("RENDER_APP_URL"),
        help="Base URL of deployed Render application (or RENDER_APP_URL env var)."
    )
    parser.add_argument(
        "--path",
        default=os.environ.get("HEALTH_PATH", "/api/health"),
        help="Relative health endpoint path (default: /api/health)."
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=float(os.environ.get("REQUEST_TIMEOUT", "35.0")),
        help="Timeout in seconds for cold-start and HTTP requests (default: 35.0)."
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=int(os.environ.get("MAX_RETRIES", "3")),
        help="Maximum bounded retry attempts (default: 3)."
    )
    parser.add_argument(
        "--retry-delay",
        type=float,
        default=float(os.environ.get("RETRY_DELAY", "3.0")),
        help="Base retry delay in seconds before exponential backoff (default: 3.0)."
    )
    parser.add_argument(
        "--jitter",
        type=float,
        default=1.0,
        help="Maximum random jitter in seconds added to backoff (default: 1.0)."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate parameters and URL without sending network requests."
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable detailed diagnostic log output."
    )
    parser.add_argument(
        "--allow-insecure-http",
        action="store_true",
        help="Allow http:// scheme and localhost/loopback (strictly for local development/testing)."
    )
    parser.add_argument(
        "--no-alert",
        action="store_true",
        help="Disable Telegram / external alerting on persistent failure."
    )
    parser.add_argument(
        "--alert-test",
        action="store_true",
        help="Dispatch a test notification to verify alert credentials and exit."
    )

    args = parser.parse_args()

    if args.alert_test:
        target = args.url or "https://example.onrender.com"
        ok = send_alert(
            target_url=target,
            endpoint=args.path,
            status="TEST_NOTIFICATION",
            attempts=1,
            last_http_status=200,
            last_error="Self-test message triggered via --alert-test",
            latency_ms=120.0
        )
        return EXIT_SUCCESS if ok else EXIT_PERSISTENT_FAILURE

    if not args.url:
        log("Configuration Error: Missing target URL. Specify --url or set RENDER_APP_URL environment variable.")
        return EXIT_CONFIG_ERROR

    exit_code, result = run_watchdog(
        base_url=args.url,
        path=args.path,
        timeout=args.timeout,
        max_retries=args.max_retries,
        base_delay=args.retry_delay,
        jitter=args.jitter,
        dry_run=args.dry_run,
        verbose=args.verbose,
        allow_insecure_http=args.allow_insecure_http,
        alert_on_failure=not args.no_alert
    )

    # Emit structured JSON summary to stdout
    print("\n--- WATCHDOG_STRUCTURED_SUMMARY ---")
    print(json.dumps(result.to_dict(), indent=2))
    print("-----------------------------------\n")

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
