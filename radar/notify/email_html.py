"""Turn the digest/reminder Markdown into an email: styled HTML plus a plain-text copy.

Email clients ignore <style> blocks and scripts, so styles are inline. All text is escaped before
any markup is added (titles and summaries come from scraped agency pages), and links are kept only
when they are http(s).
"""
import html
import re
from urllib.parse import urlparse

TEAL, INK, MUTED, LINE = "#0F4C5C", "#1D2A30", "#5B6B72", "#D9E3E6"

# The URL may contain one level of brackets, e.g. a Wikipedia link or "javascript:alert(1)"
_LINK = re.compile(r"\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)")
_BOLD = re.compile(r"\*\*(.+?)\*\*")
_ITALIC = re.compile(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])")
_CODE = re.compile(r"`([^`]+)`")
_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
_BULLET = re.compile(r"^\s*[-*+•]\s+(.*)$")
_NUMBERED = re.compile(r"^\s*\d+[.)]\s+(.*)$")


def _safe_url(url: str) -> str | None:
    parsed = urlparse(html.unescape(url))
    return url if parsed.scheme in ("http", "https") and parsed.netloc else None


def _inline(text: str) -> str:
    """Escape, then add bold, italic, code and links. Unsafe links become plain text."""
    out = html.escape(text, quote=True)

    def link(m: re.Match[str]) -> str:
        url = _safe_url(m.group(2))
        if not url:
            return m.group(1)
        return f'<a href="{url}" style="color:{TEAL};font-weight:600;text-decoration:underline">{m.group(1)}</a>'

    out = _LINK.sub(link, out)
    out = _BOLD.sub(r"<strong>\1</strong>", out)
    out = _ITALIC.sub(r"<em>\1</em>", out)
    return _CODE.sub(r'<code style="background:#EEF4F5;padding:1px 4px;border-radius:3px">\1</code>', out)


def markdown_to_email_html(md: str, title: str = "Research Opportunity Radar") -> str:
    """A complete HTML email for a digest or reminder written in the radar's Markdown."""
    body: list[str] = []
    list_tag: str | None = None

    def close_list() -> None:
        nonlocal list_tag
        if list_tag:
            body.append(f"</{list_tag}>")
            list_tag = None

    for raw in md.replace("\r\n", "\n").split("\n"):
        line = raw.rstrip()
        if not line.strip():
            close_list()
            continue
        heading = _HEADING.match(line)
        if heading:
            close_list()
            level = len(heading.group(1))
            size, top = ("20px", "0") if level == 1 else ("16px", "18px")
            body.append(f'<h{min(level, 3)} style="margin:{top} 0 6px;font-size:{size};line-height:1.3;color:{TEAL}">{_inline(heading.group(2))}</h{min(level, 3)}>')
            continue
        for tag, pattern in (("ul", _BULLET), ("ol", _NUMBERED)):
            item = pattern.match(line)
            if item:
                if list_tag != tag:
                    close_list()
                    body.append(f'<{tag} style="margin:0 0 8px;padding-left:20px">')
                    list_tag = tag
                body.append(f'<li style="margin:0 0 4px">{_inline(item.group(1))}</li>')
                break
        else:
            close_list()
            body.append(f'<p style="margin:0 0 10px">{_inline(line)}</p>')
    close_list()

    return (
        "<!doctype html><html><head><meta charset=\"utf-8\">"
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{html.escape(title)}</title></head>"
        f'<body style="margin:0;padding:0;background:#F3F7F8">'
        f'<div style="max-width:600px;margin:0 auto;padding:24px 16px;font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.5;color:{INK}">'
        f'<div style="font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:{TEAL};margin-bottom:12px">Research Opportunity Radar</div>'
        f'<div style="background:#FFFFFF;border:1px solid {LINE};border-radius:12px;padding:20px">{"".join(body)}</div>'
        f'<p style="margin:14px 4px 0;font-size:12px;color:{MUTED}">You get this because email alerts are on in your Radar settings. '
        "You can change reminder days or turn email off in Settings.</p>"
        "</div></body></html>"
    )


def markdown_to_text(md: str) -> str:
    """The same message as plain text, for the text/plain part of the email."""
    lines = []
    for line in md.replace("\r\n", "\n").split("\n"):
        heading = _HEADING.match(line)
        if heading:
            line = heading.group(2).upper() if len(heading.group(1)) == 1 else heading.group(2)
        line = _LINK.sub(lambda m: f"{m.group(1)}: {m.group(2)}", line)
        line = _BOLD.sub(r"\1", line)
        line = _ITALIC.sub(r"\1", line)
        lines.append(_CODE.sub(r"\1", line))
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip() + "\n"
