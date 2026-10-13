"""Department of Science & Technology (DST) calls adapter.

dst.gov.in moved (Oct 2026) from a Drupal table to a Next.js front end over a WordPress API at
``/cms/wp-json``. The browser builds every page from two feeds, which this adapter reads directly:

- ``post-page/call_for_proposals``: the "Call for Proposals" section ({"posts": [...], "total_items"}).
- ``post-page/whats_new``: DST's announcements, where most calls are actually posted, mixed with job
  adverts and notices. Each post's ``acf_data`` is either {"type": "External Link", "external_link"}
  or {"type": "PDF", "file": [<document post id>]}; ``post-page/post?id=<id>`` resolves the id to
  ``acf_data.pdf.url``. The deadline is in the PDF or the linked page, which the pipeline reads.

A response without a "posts" list means the API changed: that raises, so the source is reported as
failed instead of silently returning no calls (which is what the old HTML parser did after the move).
"""
import re
from datetime import timedelta
from typing import Any

from radar.deadlines.deadline_engine import today_ist
from radar.sources.agency_scraper_base import AgencyAdapter, latest_cued_deadline
from radar.sources.http import FetchError, fetch

BASE = "https://www.dst.gov.in"
API = f"{BASE}/cms/wp-json"
CALLS_URL = f"{API}/post-page/call_for_proposals?limit=50&page=1&sort=acf&order=DESC&search="
NEWS_URL = f"{API}/post-page/whats_new"
MAX_AGE_DAYS = 240  # an announcement older than this with no readable deadline is almost surely closed
MAX_FILE_LOOKUPS = 20

CALL_TITLE = re.compile(
    r"(call for (?:r&d |research )?(?:proposals?|applications?|nominations?)|proposals? (?:are )?invited|"
    r"invit\w* (?:\w+ ){0,4}(?:proposals?|applications?)|applications? (?:are )?invited|fellowships?|"
    r"research (?:grants?|scheme)|scientist scheme)",
    re.I,
)
# Job adverts and appointments use the same "applications invited" wording
NOT_A_CALL = re.compile(
    r"\b(posts? of|recruitment|vacanc\w*|deputation|appointment|director|president|personal assistant|"
    r"management team|tender|result|selected|shortlisted|corrigendum|extension of last date for submission of application for the post)\b"
    r"|\(form\)",  # the application form posted next to its call
    re.I,
)


def _posts(payload: Any, url: str) -> list[dict[str, Any]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("posts"), list):
        raise ValueError(f"unexpected response from {url} (DST API changed?)")
    return payload["posts"]


def _clean(text: str) -> str:
    return " ".join((text or "").split())


def parse_dst_posts(posts: list[dict[str, Any]], from_news: bool) -> list[dict[str, Any]]:
    """Call-like posts as raw call dicts. News posts are filtered to calls; the calls feed is not."""
    calls: list[dict[str, Any]] = []
    for post in posts:
        title = _clean(post.get("post_title", ""))
        if len(title) <= 5:
            continue
        if from_news and (not CALL_TITLE.search(title) or NOT_A_CALL.search(title)):
            continue
        acf = post.get("acf_data") or {}
        link = acf.get("external_link") if isinstance(acf, dict) else None
        files = acf.get("file") if isinstance(acf, dict) else None
        slug = post.get("post_slug") or post.get("post_name") or ""
        calls.append({
            "title": title,
            # The external page if there is one; otherwise set to the PDF (or the post's page) below
            "url": link or None,
            "slug": slug,
            "pdf_url": None,
            "file_id": files[0] if isinstance(files, list) and files else None,
            "published": str(post.get("post_date") or "")[:10] or None,
            # Some posts state the date in their body text
            "deadline": latest_cued_deadline(_clean(re.sub(r"<[^>]+>", " ", post.get("post_content") or ""))),
            "deadline_confidence": "probable",
        })
    return calls


def resolve_file_url(file_id: Any) -> str | None:
    """The PDF behind a DST document post id, or None."""
    payload = fetch(f"{API}/post-page/post?id={int(file_id)}").json()
    post = payload.get("posts") if isinstance(payload, dict) else None
    pdf = ((post or {}).get("acf_data") or {}).get("pdf") if isinstance(post, dict) else None
    url = pdf.get("url") if isinstance(pdf, dict) else None
    return url if isinstance(url, str) and url.startswith("http") else None


class DSTAdapter(AgencyAdapter):
    agency_name = "DST"
    url = f"{BASE}/call-for-proposals"

    def _fetch_calls(self) -> list[dict[str, Any]]:
        calls = parse_dst_posts(_posts(fetch(CALLS_URL).json(), CALLS_URL), from_news=False)
        calls += parse_dst_posts(_posts(fetch(NEWS_URL).json(), NEWS_URL), from_news=True)

        oldest = (today_ist() - timedelta(days=MAX_AGE_DAYS)).isoformat()
        kept: list[dict[str, Any]] = []
        seen: set[str] = set()
        lookups = 0
        for call in calls:
            key = call["title"].lower()
            if key in seen:
                continue
            seen.add(key)
            if not call["deadline"] and call["published"] and call["published"] < oldest:
                continue
            file_id = call.pop("file_id")
            if file_id and lookups < MAX_FILE_LOOKUPS:
                lookups += 1
                try:
                    call["pdf_url"] = resolve_file_url(file_id)
                except (FetchError, ValueError, TypeError):
                    pass  # the listing entry is still usable
            slug = call.pop("slug")
            # Each call needs its own URL: a shared listing URL would merge different calls in dedup
            call["url"] = call["url"] or call["pdf_url"] or (f"{self.url}/{slug}" if slug else None)
            kept.append(call)
        return kept
