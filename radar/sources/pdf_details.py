"""Pull call details out of an agency's call-for-proposals PDF.

Indian agency listings give a title, a date and a link to a PDF; the scope, eligibility, budget and
often the only stated deadline live in that PDF. For newly discovered calls we read the first pages
and keep plain-text excerpts in the opportunity's metadata, where scoring and the eligibility check
look for them (``solicitation_guidelines`` and ``eligibility_clause``).
"""
import io
import logging
import re
from typing import Any

from pypdf import PdfReader

from radar.deadlines.deadline_engine import lifecycle_status, parse_deadline
from radar.models import Opportunity, OpportunityDeadline
from radar.sources.http import FetchError, fetch

logger = logging.getLogger(__name__)

MAX_PAGES = 8
MAX_DOCS_PER_RUN = 40
SUMMARY_CHARS = 800
EXCERPT_CHARS = 1500
GUIDELINES_CHARS = 12000

_ELIGIBILITY_HEADING = re.compile(r"\b(eligibility(?:\s+criteria)?|who\s+can\s+apply|eligible\s+(?:applicants|institutions))\b", re.I)
_NEXT_HEADING = re.compile(r"\s(?:\d{1,2}\.|[IVX]{1,4}\.)\s+[A-Z][A-Za-z ]{3,40}:?\s")
_DEADLINE_CUE = re.compile(r"(last\s+date|deadline|closing\s+date|due\s+date|submission\s+(?:date|deadline)|on\s+or\s+before)", re.I)
_BUDGET = re.compile(
    r"(?:(?:\bRs\.?|\bINR|₹)\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:lakhs?|lacs?|crores?|cr\b))?"
    r"|\b\d[\d,]*(?:\.\d+)?\s*(?:lakhs?|lacs?|crores?)\b)",
    re.I,
)
_BUDGET_CUE = re.compile(r"(budget|funding|grant\s+amount|financial\s+support|up\s*to|maximum|ceiling)", re.I)


def pdf_text(content: bytes, max_pages: int = MAX_PAGES) -> str:
    """Whitespace-normalised text of the first pages of a PDF."""
    reader = PdfReader(io.BytesIO(content))
    parts = []
    for page in reader.pages[:max_pages]:
        try:
            parts.append(page.extract_text() or "")
        except Exception:  # one malformed page shouldn't lose the rest
            continue
    return " ".join(" ".join(parts).split())


def _excerpt_after(pattern: re.Pattern[str], text: str, length: int) -> str | None:
    match = pattern.search(text)
    if not match:
        return None
    chunk = text[match.start():match.start() + length]
    end = _NEXT_HEADING.search(chunk, 40)
    return (chunk[:end.start()] if end else chunk).strip()


def _budget(text: str) -> str | None:
    for cue in _BUDGET_CUE.finditer(text):
        window = text[cue.start():cue.start() + 200]
        amount = _BUDGET.search(window)
        if amount:
            return amount.group(0).strip()
    return None


def _deadline_text(text: str) -> str | None:
    for cue in _DEADLINE_CUE.finditer(text):
        window = text[cue.start():cue.start() + 140]
        if parse_deadline(window)[0]:
            return window
    return None


def extract_call_details(text: str) -> dict[str, Any]:
    """Summary, eligibility, budget and deadline text found in a call document."""
    details: dict[str, Any] = {}
    if not text:
        return details
    details["summary"] = text[:SUMMARY_CHARS].rsplit(" ", 1)[0] + ("…" if len(text) > SUMMARY_CHARS else "")
    details["solicitation_guidelines"] = text[:GUIDELINES_CHARS]
    eligibility = _excerpt_after(_ELIGIBILITY_HEADING, text, EXCERPT_CHARS)
    if eligibility:
        details["eligibility_clause"] = eligibility
    budget = _budget(text)
    if budget:
        details["budget"] = budget
    deadline = _deadline_text(text)
    if deadline:
        details["deadline_text"] = deadline
    return details


def _pdf_url(opp: Opportunity) -> str | None:
    url = opp.metadata.get("pdf_url") or opp.primary_source_url or ""
    return url if url.lower().split("?")[0].endswith(".pdf") else None


def enrich_with_pdf_details(opps: list[Opportunity], max_docs: int = MAX_DOCS_PER_RUN) -> int:
    """Read the call PDF of each funding opportunity (new ones only; callers pass those) and merge
    the details in. Returns how many PDFs were read. Failures are logged and skipped."""
    read = 0
    for opp in opps:
        if read >= max_docs:
            break
        if opp.kind != "funding" or opp.metadata.get("pdf_details_read"):
            continue
        url = _pdf_url(opp)
        if not url:
            continue
        try:
            text = pdf_text(fetch(url).content)
        except (FetchError, Exception) as exc:
            logger.info(f"Could not read call PDF {url}: {exc.__class__.__name__}")
            continue
        read += 1
        details = extract_call_details(text)
        opp.metadata["pdf_details_read"] = True
        for key in ("solicitation_guidelines", "eligibility_clause", "budget"):
            if details.get(key):
                opp.metadata[key] = details[key]
        if details.get("summary") and (not opp.summary or opp.summary.startswith("Call for proposals from")):
            opp.summary = details["summary"]

        # Only when the listing gave no date: take the one the document states
        if not any(d.deadline_date for d in opp.deadlines) and details.get("deadline_text"):
            dl_date, _ = parse_deadline(details["deadline_text"])
            if dl_date:
                opp.deadlines.append(OpportunityDeadline(
                    deadline_type="full_proposal",
                    deadline_date=dl_date,
                    confidence="probable",
                    raw_text=details["deadline_text"][:200],
                ))
                status = lifecycle_status(opp.title, [dl_date])
                opp.status = "open" if status == "open" else "closed"
    return read
