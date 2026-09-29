"""Brevo transactional email notification provider."""
import html

import requests

from radar import config


def send(subject: str, markdown_text: str, recipient: str | None = None) -> None:
    """Send to recipient, or to the operator-wide BREVO_RECIPIENT_EMAIL when none is given."""
    to_email = recipient or config.BREVO_RECIPIENT_EMAIL
    if not config.BREVO_API_KEY or not config.BREVO_SENDER_EMAIL or not to_email:
        return

    url = "https://api.brevo.com/v3/smtp/email"
    headers = {
        "api-key": config.BREVO_API_KEY,
        "Content-Type": "application/json"
    }

    # Escape: digest text includes scraped titles/summaries
    html_content = f"<html><body><pre style='font-family: sans-serif;'>{html.escape(markdown_text)}</pre></body></html>"

    payload = {
        "sender": {"email": config.BREVO_SENDER_EMAIL, "name": "Research Radar"},
        "to": [{"email": to_email}],
        "subject": subject,
        "htmlContent": html_content
    }

    res = requests.post(url, json=payload, headers=headers, timeout=10)
    res.raise_for_status()
