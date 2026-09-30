"""Optional WhatsApp Cloud API notification provider.

This module provides a fully optional WhatsApp Business Cloud API integration
using Meta's Graph API (graph.facebook.com/v19.0/{phone_number_id}/messages).

IMPORTANT — READ BEFORE ENABLING:
  WhatsApp Cloud API has real costs and significant approval overhead in India.
  See docs/WHATSAPP_SETUP.md for the full evaluation.

  This module activates ONLY when both of these environment variables are set:
    WHATSAPP_PHONE_NUMBER_ID  — Your Meta Business phone number ID
    WHATSAPP_ACCESS_TOKEN     — Your System User permanent access token

  If either variable is unset, every call to send() or send_template() is a
  silent no-op. The existing Telegram channel continues to be the default
  zero-cost, zero-approval alert mechanism.
"""
from __future__ import annotations

import logging
import os

import requests

from radar.notify.telegram import _chunk_lines

logger = logging.getLogger(__name__)

_GRAPH_API_BASE = "https://graph.facebook.com/v19.0"
_WHATSAPP_MAX_TEXT_LEN = 4096  # WhatsApp Cloud API hard limit per text message


def _get_config() -> tuple[str, str] | None:
    """Return (phone_number_id, access_token) or None if not configured."""
    phone_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID", "").strip()
    token = os.getenv("WHATSAPP_ACCESS_TOKEN", "").strip()
    if not phone_id or not token:
        return None
    return phone_id, token


def send(text: str, recipient: str | None = None) -> bool:
    """Send a plain text WhatsApp message to the configured recipient.

    Args:
        text: Message text (max 4096 chars; longer messages are chunked automatically).
        recipient: E.164 phone number (e.g. '+919876543210'). Falls back to
                   WHATSAPP_DEFAULT_RECIPIENT env var if not supplied.

    Returns:
        True if all chunks were delivered successfully, False if not configured
        or a chunk failed. Sending stops at the first failed chunk, so the
        recipient never gets a digest with a gap in the middle.
    """
    cfg = _get_config()
    if not cfg:
        return False  # Silently skip — channel not configured

    phone_number_id, access_token = cfg
    to = recipient or os.getenv("WHATSAPP_DEFAULT_RECIPIENT", "").strip()
    if not to:
        logger.warning("WhatsApp send() skipped: no recipient phone number configured.")
        return False
    if not (text or "").strip():
        logger.warning("WhatsApp send() skipped: empty message.")
        return False  # nothing was delivered, so don't report success

    url = f"{_GRAPH_API_BASE}/{phone_number_id}/messages"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    # Split on line boundaries so no deadline line or link is cut in half
    for chunk in _chunk_lines(text, _WHATSAPP_MAX_TEXT_LEN):
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "text",
            "text": {"body": chunk, "preview_url": False},
        }
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=15)
            resp.raise_for_status()
        except requests.RequestException as exc:
            logger.error("WhatsApp send() failed: %s", exc)
            return False

    return True


def send_template(
    template_name: str,
    language_code: str = "en",
    components: list[dict] | None = None,
    recipient: str | None = None,
) -> bool:
    """Send a pre-approved WhatsApp Message Template.

    Template messages are required for outbound messages to users who have not
    messaged you within the last 24 hours (the standard deadline alert use case).

    Args:
        template_name: Approved Meta template name (e.g. 'academic_deadline_alert').
        language_code: ISO language code for the template (default 'en').
        components: Optional list of component dicts for parameter substitution.
        recipient: E.164 phone number. Falls back to WHATSAPP_DEFAULT_RECIPIENT.

    Returns:
        True if the template was dispatched successfully.
    """
    cfg = _get_config()
    if not cfg:
        return False

    phone_number_id, access_token = cfg
    to = recipient or os.getenv("WHATSAPP_DEFAULT_RECIPIENT", "").strip()
    if not to:
        logger.warning("WhatsApp send_template() skipped: no recipient phone number configured.")
        return False

    url = f"{_GRAPH_API_BASE}/{phone_number_id}/messages"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    template_payload: dict = {
        "name": template_name,
        "language": {"code": language_code},
    }
    if components:
        template_payload["components"] = components

    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "template",
        "template": template_payload,
    }

    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=15)
        resp.raise_for_status()
        return True
    except requests.RequestException as exc:
        logger.error("WhatsApp send_template() failed: %s", exc)
        return False


def is_configured() -> bool:
    """Return True if both WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN are set."""
    return _get_config() is not None
