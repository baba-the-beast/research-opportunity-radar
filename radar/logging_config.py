"""
Structured logging module for Research Opportunity Radar.
Ensures every log record carries run_id, source_name, and error_category tags,
and enforces zero-secrets redaction for tokens, keys, and passwords.
"""
import logging
import re
from typing import Any

# Regex patterns matching secret key assignment or common bearer/JWT/service tokens
SENSITIVE_PATTERNS = [
    re.compile(r'(?i)\b(token|key|secret|password|api_key|bot_token|service_role_key|bearer)\s*[:=]\s*["\']?([^"\'\s,;]{6,})["\']?'),
    re.compile(r'\b(sbp_[a-zA-Z0-9_]{16,}|eyJh[a-zA-Z0-9_\-\.]{30,})\b'),
]


def sanitize_log_text(text: str) -> str:
    """Replaces sensitive key or token values with [REDACTED]."""
    if not isinstance(text, str):
        text = str(text)
    sanitized = text
    for pat in SENSITIVE_PATTERNS:
        if pat.groups == 2:
            sanitized = pat.sub(r'\1=[REDACTED]', sanitized)
        else:
            sanitized = pat.sub(r'[REDACTED]', sanitized)
    return sanitized


class StructuredLogger:
    """Logger wrapper providing structured contextual metadata tags and secret redaction."""

    def __init__(self, name: str):
        self._logger = logging.getLogger(name)

    def _fmt(
        self,
        message: str,
        run_id: str | None = None,
        source_name: str | None = None,
        error_category: str | None = None
    ) -> str:
        rid = run_id or "NONE"
        src = source_name or "CORE"
        cat = error_category or "INFO"
        safe_msg = sanitize_log_text(message)
        return f"[run_id={rid}][source={src}][category={cat}] {safe_msg}"

    def info(self, message: str, run_id: str | None = None, source_name: str | None = None, **kwargs: Any) -> None:
        self._logger.info(self._fmt(message, run_id, source_name, "INFO"), **kwargs)

    def warning(
        self,
        message: str,
        run_id: str | None = None,
        source_name: str | None = None,
        error_category: str = "WARNING",
        **kwargs: Any
    ) -> None:
        self._logger.warning(self._fmt(message, run_id, source_name, error_category), **kwargs)

    def error(
        self,
        message: str,
        run_id: str | None = None,
        source_name: str | None = None,
        error_category: str = "API_ERROR",
        **kwargs: Any
    ) -> None:
        self._logger.error(self._fmt(message, run_id, source_name, error_category), **kwargs)

    def debug(self, message: str, run_id: str | None = None, source_name: str | None = None, **kwargs: Any) -> None:
        self._logger.debug(self._fmt(message, run_id, source_name, "DEBUG"), **kwargs)


def get_logger(name: str) -> StructuredLogger:
    return StructuredLogger(name)

