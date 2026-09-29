"""One-time Telegram bot setup for Research Opportunity Radar.

Run after creating (or revoking and re-creating) the bot token with @BotFather:

    python scripts/telegram_setup.py --app-url https://your-app.onrender.com
    python scripts/telegram_setup.py --check            # status only, changes nothing

Reads TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET from the environment (or .env). It:
  1. verifies the token (getMe) and prints the bot username to use as TELEGRAM_BOT_USERNAME
  2. registers <app-url>/api/telegram/webhook with the secret Telegram echoes on every update
  3. sets the /start and /stop command menu
  4. prints the webhook status, including Telegram's last delivery error if any

The token is never printed: errors are reported without the request URL, which contains it.
"""
import argparse
import os
import sys
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv

API = "https://api.telegram.org/bot{token}/{method}"


class SetupError(Exception):
    pass


def call(token: str, method: str, payload: dict | None = None) -> dict:
    try:
        res = requests.post(API.format(token=token, method=method), json=payload or {}, timeout=15)
    except requests.RequestException as e:
        raise SetupError(f"{method}: request failed ({type(e).__name__})") from None
    try:
        body = res.json()
    except ValueError:
        raise SetupError(f"{method}: HTTP {res.status_code}, non-JSON response") from None
    if not body.get("ok"):
        hint = " (token is invalid or revoked: get a new one from @BotFather)" if res.status_code == 401 else ""
        raise SetupError(f"{method}: HTTP {res.status_code} {body.get('description', '')}{hint}")
    return body.get("result", {})


def webhook_url(app_url: str) -> str:
    parsed = urlparse(app_url.strip())
    if parsed.scheme != "https" or not parsed.netloc:
        raise SetupError("--app-url must be the public https:// address of the web app (Telegram requires HTTPS)")
    return f"https://{parsed.netloc}{parsed.path.rstrip('/')}/api/telegram/webhook"


def print_status(token: str) -> None:
    info = call(token, "getWebhookInfo")
    print(f"  webhook url:      {info.get('url') or '(not set)'}")
    print(f"  pending updates:  {info.get('pending_update_count', 0)}")
    if info.get("last_error_message"):
        print(f"  last error:       {info['last_error_message']}")


def main() -> int:
    load_dotenv()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--app-url", default=os.getenv("APP_URL") or os.getenv("RENDER_APP_URL"),
                        help="public https URL of the web app (default: $APP_URL or $RENDER_APP_URL)")
    parser.add_argument("--check", action="store_true", help="only verify the token and show webhook status")
    args = parser.parse_args()

    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    secret = os.getenv("TELEGRAM_WEBHOOK_SECRET", "").strip()
    if not token:
        print("TELEGRAM_BOT_TOKEN is not set.", file=sys.stderr)
        return 1

    try:
        me = call(token, "getMe")
        username = me.get("username", "")
        print(f"Bot OK: @{username}")
        print(f"  Set TELEGRAM_BOT_USERNAME={username} on the web server.")

        if args.check:
            print_status(token)
            return 0

        if not args.app_url:
            raise SetupError("pass --app-url https://your-app (or set APP_URL) to register the webhook")
        if len(secret) < 16 or not all(c.isalnum() or c in "_-" for c in secret):
            raise SetupError(
                "TELEGRAM_WEBHOOK_SECRET must be 16-256 chars of A-Z, a-z, 0-9, _ or - "
                "(e.g. python -c \"import secrets; print(secrets.token_urlsafe(32))\")"
            )

        url = webhook_url(args.app_url)
        call(token, "setWebhook", {
            "url": url,
            "secret_token": secret,
            "allowed_updates": ["message"],
            "drop_pending_updates": True,
        })
        print(f"Webhook registered: {url}")

        call(token, "setMyCommands", {"commands": [
            {"command": "start", "description": "Connect this chat to your Radar account"},
            {"command": "stop", "description": "Stop alerts to this chat"},
        ]})
        print("Commands set: /start, /stop")

        print_status(token)
        print("\nNext: Settings -> Connect Telegram in the dashboard, then 'Send test message'.")
        return 0
    except SetupError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
