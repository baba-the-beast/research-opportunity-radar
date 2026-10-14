"""Digest and reminder emails: formatted HTML (not raw Markdown), safe against scraped content."""
from unittest.mock import MagicMock

from radar import config
from radar.notify import email_brevo
from radar.notify.email_html import markdown_to_email_html, markdown_to_text

DIGEST = """# 2 new calls that match your research

### 1. ANRF Core Research Grant 2026
- Due 30 Nov 2026 (in 47 days) · ANRF
- Match 82.0/100: power electronics, grid integration
- 🏛️ Recommended by your research office, internal deadline 16 Nov 2026
- [Official call page](https://anrfonline.in/ANRF/crg)

### 2. MeitY Edge AI Hardware
- Due 15 Dec 2026 (in 62 days) · MeitY
- ⚠️ Check before applying: the age limit.

*Not checked this time: DST. They are tried again on the next scan.*
"""


def test_digest_becomes_html_without_markdown_symbols():
    out = markdown_to_email_html(DIGEST)
    assert '<h1 style="' in out and "2 new calls that match your research</h1>" in out
    assert out.count("<h3 ") == 2
    assert out.count("<ul ") == 2 and out.count("<li ") == 6
    assert '<a href="https://anrfonline.in/ANRF/crg"' in out and ">Official call page</a>" in out
    assert "<em>Not checked this time: DST. They are tried again on the next scan.</em>" in out
    body = out.split("<body", 1)[1]
    assert "###" not in body and "**" not in body and "](" not in body


def test_scraped_html_is_escaped_and_unsafe_links_are_dropped():
    out = markdown_to_email_html('### <script>alert(1)</script> call\n- [click](javascript:alert(1))\n- [x](data:text/html,y)\n- "quotes" & <b>tags</b>')
    assert "<script>" not in out and "&lt;script&gt;" in out
    assert "javascript:" not in out and "data:text" not in out
    assert "<li style=\"margin:0 0 4px\">click</li>" in out
    assert "&quot;quotes&quot; &amp; &lt;b&gt;tags&lt;/b&gt;" in out


def test_reminder_style_telegram_markup_reads_well():
    out = markdown_to_email_html("⏰ *Deadline in 3 days*\n\n**ANRF CRG**\nANRF\nFull proposal: 30 Nov 2026")
    assert "<em>Deadline in 3 days</em>" in out and "<strong>ANRF CRG</strong>" in out


def test_plain_text_copy_has_no_markdown():
    text = markdown_to_text(DIGEST)
    assert text.startswith("2 NEW CALLS THAT MATCH YOUR RESEARCH")
    assert "Official call page: https://anrfonline.in/ANRF/crg" in text
    assert "###" not in text and "**" not in text and "*Not" not in text


def test_brevo_sends_html_and_text_parts(monkeypatch):
    monkeypatch.setattr(config, "BREVO_API_KEY", "xkeysib-test")
    monkeypatch.setattr(config, "BREVO_SENDER_EMAIL", "radar@example.org")
    post = MagicMock()
    monkeypatch.setattr(email_brevo.requests, "post", post)
    email_brevo.send("2 new calls", DIGEST, recipient="faculty@example.org")
    payload = post.call_args.kwargs["json"]
    assert payload["htmlContent"].startswith("<!doctype html>") and "<h3 " in payload["htmlContent"]
    assert payload["textContent"].startswith("2 NEW CALLS")
    assert payload["to"] == [{"email": "faculty@example.org"}]
