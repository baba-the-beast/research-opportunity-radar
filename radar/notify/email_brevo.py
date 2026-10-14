"""Brevo transactional email notification provider."""
import requests

from radar import config
from radar.notify.email_html import markdown_to_email_html, markdown_to_text


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

    payload = {
        "sender": {"email": config.BREVO_SENDER_EMAIL, "name": "Research Radar"},
        "to": [{"email": to_email}],
        "subject": subject,
        # Formatted email, with a plain-text copy for clients (and spam filters) that want one
        "htmlContent": markdown_to_email_html(markdown_text, title=subject),
        "textContent": markdown_to_text(markdown_text)
    }

    res = requests.post(url, json=payload, headers=headers, timeout=10)
    res.raise_for_status()
