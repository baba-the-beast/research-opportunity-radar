"""Brevo transactional email notification provider."""
import requests

from radar import config


def send(subject: str, markdown_text: str) -> None:
    if not config.BREVO_API_KEY or not config.BREVO_SENDER_EMAIL or not config.BREVO_RECIPIENT_EMAIL:
        return

    url = "https://api.brevo.com/v3/smtp/email"
    headers = {
        "api-key": config.BREVO_API_KEY,
        "Content-Type": "application/json"
    }

    # Convert simple markdown headers/bullet to basic html
    html_content = f"<html><body><pre style='font-family: sans-serif;'>{markdown_text}</pre></body></html>"

    payload = {
        "sender": {"email": config.BREVO_SENDER_EMAIL, "name": "Research Radar"},
        "to": [{"email": config.BREVO_RECIPIENT_EMAIL}],
        "subject": subject,
        "htmlContent": html_content
    }

    res = requests.post(url, json=payload, headers=headers, timeout=10)
    res.raise_for_status()
