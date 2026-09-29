"""Telegram sender: formatting, chunking, retries, blocked chats, and the setup script's validation."""
from unittest.mock import MagicMock, patch

import pytest
import requests

from radar import config
from radar.notify import recipients, telegram

TOKEN = "1234567890:AAFakeFakeFakeFakeFakeFakeFake12"


@pytest.fixture
def bot(monkeypatch):
    monkeypatch.setattr(config, "TELEGRAM_BOT_TOKEN", TOKEN)
    monkeypatch.setattr(config, "TELEGRAM_CHAT_ID", "42")
    monkeypatch.setattr(telegram.time, "sleep", lambda s: None)


def _resp(status, body=None):
    r = MagicMock(status_code=status)
    r.json.return_value = body or {"ok": status == 200}
    if status >= 400:
        r.raise_for_status.side_effect = requests.HTTPError(f"{status} for url: https://api.telegram.org/bot{TOKEN}/x")
    return r


def test_markdown_digest_becomes_telegram_html():
    md = (
        "# Weekly Digest\n"
        "> [!WARNING]\n"
        "> **Source warnings:** retry soon\n"
        "---\n"
        "### 1. Graphs & <Networks>\n"
        "- **Source:** OpenAlex · [https://x.org/a?b=1&c=2](https://x.org/a?b=1&c=2)\n"
        "- **Relevance:** Score: 91.0/100 — Overlaps: *graph learning*\n"
    )
    out = telegram.markdown_to_telegram_html(md)
    assert "<b>Weekly Digest</b>" in out
    assert "⚠️" in out and "[!WARNING]" not in out
    assert "<b>1. Graphs &amp; &lt;Networks&gt;</b>" in out  # user text escaped
    assert '<a href="https://x.org/a?b=1&amp;c=2">' in out
    assert "<i>graph learning</i>" in out
    assert "###" not in out and "**" not in out and "---" not in out


def test_chunks_split_on_line_boundaries():
    text = "".join(f"line {i:04d} " + "x" * 40 + "\n" for i in range(300))
    chunks = telegram._chunk_lines(text, 4000)
    assert len(chunks) > 1
    assert all(len(c) <= 4000 for c in chunks)
    assert all(c.endswith("\n") for c in chunks[:-1])  # never cut mid-line
    assert "".join(chunks) == text


def test_sends_html_and_retries_on_rate_limit(bot):
    responses = [_resp(429, {"ok": False, "parameters": {"retry_after": 2}}), _resp(200)]
    with patch("requests.post", side_effect=responses) as post:
        telegram.send("**hi**", chat_id="7")
    assert post.call_count == 2
    payload = post.call_args.kwargs["json"]
    assert payload["parse_mode"] == "HTML" and payload["text"] == "<b>hi</b>" and payload["chat_id"] == "7"


def test_falls_back_to_plain_text_when_formatting_rejected(bot):
    bad_parse = _resp(400, {"ok": False, "description": "Bad Request: can't parse entities"})
    with patch("requests.post", side_effect=[bad_parse, _resp(200)]) as post:
        telegram.send("**hi**")
    final = post.call_args.kwargs["json"]
    assert "parse_mode" not in final and final["text"] == "**hi**"


def test_blocked_chat_raises_telegram_blocked_without_token(bot):
    blocked = _resp(403, {"ok": False, "description": "Forbidden: bot was blocked by the user"})
    with patch("requests.post", return_value=blocked), pytest.raises(telegram.TelegramBlocked) as exc:
        telegram.send("hi")
    assert "blocked" in str(exc.value) and "AAFake" not in str(exc.value)


def test_dispatch_disconnects_user_who_blocked_the_bot(bot, monkeypatch):
    from radar.db import client as db
    prefs = db.get_client().table("user_preferences")
    prefs._rows = [{"user_id": "u1", "telegram_alerts": True, "telegram_chat_id": "7"}]
    monkeypatch.setattr(telegram, "send", MagicMock(side_effect=telegram.TelegramBlocked("HTTP 403")))

    target = recipients.AlertTarget(faculty_id="f1", user_id="u1", telegram_chat_id="7")
    errors = recipients.dispatch(target, "subject", "text")

    assert len(errors) == 1 and "disabled" in errors[0]
    assert prefs._rows[0]["telegram_alerts"] is False and prefs._rows[0]["telegram_chat_id"] is None


def test_setup_script_validates_url_and_never_prints_token(capsys, monkeypatch):
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[2] / "scripts" / "telegram_setup.py"
    spec = importlib.util.spec_from_file_location("telegram_setup", path)
    setup = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(setup)

    assert setup.webhook_url("https://radar.onrender.com/") == "https://radar.onrender.com/api/telegram/webhook"
    with pytest.raises(setup.SetupError):
        setup.webhook_url("http://radar.onrender.com")

    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TOKEN)
    monkeypatch.setattr(setup, "load_dotenv", lambda: None)
    monkeypatch.setattr("sys.argv", ["telegram_setup.py", "--check"])
    unauthorized = MagicMock(status_code=401)
    unauthorized.json.return_value = {"ok": False, "description": "Unauthorized"}
    with patch("requests.post", return_value=unauthorized):
        assert setup.main() == 1
    out = capsys.readouterr()
    assert "@BotFather" in out.err and "AAFake" not in out.err + out.out
