"""Telegram bot notification provider.

Messages are sent with parse_mode=HTML: the digests are written in Markdown (### headings, **bold**,
[links](url)), which Telegram's legacy Markdown mode cannot parse, so they are converted here.
Errors raised from this module never contain the request URL, because it embeds the bot token.
"""
import html
import re
import time

import requests

from radar import config

MAX_MESSAGE_CHARS = 4000  # Telegram hard limit is 4096; leave room for tag overhead
MAX_RATE_LIMIT_WAIT_S = 30
MAX_ATTEMPTS = 3


class TelegramBlocked(requests.HTTPError):
    """The chat can no longer be messaged (user blocked the bot, left, or deleted the chat)."""


def send(text: str, chat_id: str | None = None) -> None:
    """Send Markdown `text` to chat_id, or to the operator-wide TELEGRAM_CHAT_ID when none is given."""
    target_chat = chat_id or config.TELEGRAM_CHAT_ID
    if not config.TELEGRAM_BOT_TOKEN or not target_chat:
        return

    for chunk in _chunk_lines(text, MAX_MESSAGE_CHARS):
        _send_chunk(target_chat, chunk)


def markdown_to_telegram_html(md: str) -> str:
    """Convert the digest/alert Markdown subset to Telegram HTML (b, i, a, code)."""
    out_lines = []
    for raw in md.splitlines():
        line = raw.rstrip()
        stripped = line.lstrip()
        if stripped in ("---", "***"):
            out_lines.append("")
            continue
        if stripped.startswith(">"):
            stripped = stripped.lstrip("> ").strip()
            if stripped.upper() == "[!WARNING]":
                out_lines.append("⚠️")
                continue
            line = stripped
        heading = re.match(r"^\s*#{1,6}\s+(.*)$", line)
        text = html.escape(heading.group(1) if heading else line, quote=False)
        # Links first so their text can still carry bold/italic
        text = re.sub(
            r"\[([^\]]+)\]\((https?://[^)\s]+)\)",
            lambda m: f'<a href="{html.escape(html.unescape(m.group(2)), quote=True)}">{m.group(1)}</a>',
            text,
        )
        text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
        text = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<i>\1</i>", text)
        text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
        out_lines.append(f"<b>{text}</b>" if heading else text)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out_lines)).strip()


def _chunk_lines(text: str, limit: int) -> list[str]:
    """Split on line boundaries so no formatting or link is cut in half."""
    chunks: list[str] = []
    current = ""
    for line in text.splitlines(keepends=True):
        while len(line) > limit:  # a single oversized line: hard split
            if current:
                chunks.append(current)
                current = ""
            chunks.append(line[:limit])
            line = line[limit:]
        if len(current) + len(line) > limit:
            chunks.append(current)
            current = ""
        current += line
    if current.strip():
        chunks.append(current)
    return chunks


def _send_chunk(chat_id: str, markdown_chunk: str) -> None:
    url = f"https://api.telegram.org/bot{config.TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": markdown_to_telegram_html(markdown_chunk),
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }

    attempt = 0
    while attempt < MAX_ATTEMPTS:
        attempt += 1
        try:
            res = requests.post(url, json=payload, timeout=10)
        except requests.RequestException as e:
            if attempt == MAX_ATTEMPTS:
                # Connection/timeout errors embed the URL (and so the token); keep only the type
                raise requests.RequestException(f"Telegram request failed ({type(e).__name__})") from None
            time.sleep(attempt)
            continue

        status = res.status_code if isinstance(res.status_code, int) else 0
        if status == 429 and attempt < MAX_ATTEMPTS:
            retry_after = _json(res).get("parameters", {}).get("retry_after", 1)
            time.sleep(min(float(retry_after), MAX_RATE_LIMIT_WAIT_S))
            continue
        if status == 400 and payload.get("parse_mode") and "parse" in _description(res).lower():
            # Formatting rejected: deliver as plain text rather than not at all
            payload.pop("parse_mode")
            payload["text"] = markdown_chunk
            attempt -= 1  # the plain-text resend is not a new attempt (it happens at most once)
            continue
        if status == 403:
            raise TelegramBlocked(f"Telegram chat unreachable (HTTP 403: {_description(res)[:80]})", response=res)

        _raise_for_status_without_token(res)
        return


def _json(res: requests.Response) -> dict:
    try:
        data = res.json()
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _description(res: requests.Response) -> str:
    desc = _json(res).get("description", "")
    return desc if isinstance(desc, str) else ""


def _raise_for_status_without_token(res: requests.Response) -> None:
    """requests' HTTPError message embeds the request URL, which for Telegram contains the bot token.
    These messages reach logs and run_log.errors (readable in the dashboard), so raise without it."""
    try:
        res.raise_for_status()
    except requests.HTTPError:
        status = getattr(res, "status_code", "error")
        raise requests.HTTPError(f"Telegram API returned HTTP {status}", response=res) from None
