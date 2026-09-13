"""Telegram bot notification provider."""
import requests

from radar import config


def send(text: str) -> None:
    if not config.TELEGRAM_BOT_TOKEN or not config.TELEGRAM_CHAT_ID:
        return

    url = f"https://api.telegram.org/bot{config.TELEGRAM_BOT_TOKEN}/sendMessage"

    # Telegram limit 4096 chars per message
    chunks = [text[i:i+4000] for i in range(0, len(text), 4000)]
    for chunk in chunks:
        payload = {
            "chat_id": config.TELEGRAM_CHAT_ID,
            "text": chunk,
            "parse_mode": "Markdown"
        }
        try:
            res = requests.post(url, json=payload, timeout=10)
            res.raise_for_status()
        except Exception:
            # Fallback without parse_mode if markdown parsing fails
            payload.pop("parse_mode", None)
            res = requests.post(url, json=payload, timeout=10)
            res.raise_for_status()
