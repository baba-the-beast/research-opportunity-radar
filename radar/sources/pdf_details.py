"""Pull call details out of an agency's call-for-proposals PDF.

Indian agency listings give a title, a date and a link to a PDF; the scope, eligibility, budget and
often the only stated deadline live in that PDF. For newly discovered calls we read the first pages
and keep plain-text excerpts in the opportunity's metadata, where scoring and the eligibility check
look for them (``solicitation_guidelines`` and ``eligibility_clause``).
"""
import io
import logging
import re
from datetime import date
from typing import Any

from pypdf import PdfReader

from radar.deadlines import deadline_engine
from radar.deadlines.deadline_engine import lifecycle_status, parse_deadline, says_closed
from radar.models import Opportunity, OpportunityDeadline
from radar.sources.agency_scraper_base import DEADLINE_CUE
from radar.sources.http import FetchError, fetch

logger = logging.getLogger(__name__)

MAX_PAGES = 8
MAX_DOCS_PER_RUN = 40
SUMMARY_CHARS = 800
EXCERPT_CHARS = 1500
GUIDELINES_CHARS = 12000

_ELIGIBILITY_HEADING = re.compile(r"\b(eligibility(?:\s+criteria)?|who\s+can\s+apply|eligible\s+(?:applicants|institutions))\b", re.I)
# Not the section itself: a contents line ("Eligibility ........ 2") or a passing use ("eligibility of disbursement")
_NOT_A_HEADING = re.compile(r"\s*(?:\.{4,}|…)|\s+(?:of|for)\b", re.I)
# Headings of the sections that usually follow eligibility. Numbered items inside the section
# ("1. Must be an Indian citizen. 2. ...") are not a new section.
_NEXT_SECTION = re.compile(
    r"(?:\s(?:\d{1,2}(?:\.\d{1,2})*\.?|[IVX]{1,4}\.)\s+|[.?:]\s+)"
    r"(?:How to [Aa]pply|HOW TO APPLY|Application [Pp]rocedure|Selection|Duration|Budget|Financial [Ss]upport|"
    r"Funding [Pp]attern|Submission|Important [Dd]ates|Contact|Documents|Terms and [Cc]onditions|Procedure|Evaluation|Timelines?)\b"
)
_SECTION_NUMBER = re.compile(r"(\d{1,2})\s*[.:]?\s*$")
_DEADLINE_CUE = DEADLINE_CUE
_STRONG_CUE = re.compile(r"last\s+date|deadline|closing\s+date|end\s+date|due\s+date|submission\s+(?:date|deadline)|cut-?\s?off", re.I)
_EXTENSION = re.compile(r"\b(extend\w*|extension|revised|postpone\w*|rescheduled)\b", re.I)
_OPENING_CUE = re.compile(r"\b(?:opening(?:\s+date)?\s*:|opens\s+on|(?:portal|call|submissions?|applications?)\s+(?:will\s+)?(?:open|start)s?\s+(?:on|from))", re.I)
MAX_DEADLINES = 3
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


def _eligibility(text: str, length: int) -> str | None:
    """The eligibility section: the first capitalised heading ("Eligibility:", "Who Can Apply?"), else
    the first other mention; up to the next section."""
    found = [m for m in _ELIGIBILITY_HEADING.finditer(text) if not _NOT_A_HEADING.match(text, m.end())]
    if not found:
        return None
    match = next((m for m in found if m.group(0)[0].isupper()), found[0])
    chunk = text[match.start():match.start() + length]
    stops = [s.start() for s in [_NEXT_SECTION.search(chunk, 40)] if s]
    number = _SECTION_NUMBER.search(text[max(0, match.start() - 12):match.start()])
    if number:  # "4. Eligibility" ends at "5."
        following = re.compile(rf"\s(?:Section\s*)?{int(number.group(1)) + 1}[.:]?\s+[A-Z]").search(chunk, 40)
        if following:
            stops.append(following.start())
    return chunk[:min(stops)].strip() if stops else chunk.strip()


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


def _deadline_dates(text: str) -> list[date]:
    """Every date the document states as a deadline: some calls have several (call 1 and call 2,
    online and hard copy). When it says a deadline was extended, only the latest date stands."""
    found = []  # (strong cue?, date, extended?)
    for cue in _DEADLINE_CUE.finditer(text):
        window = text[cue.start():cue.start() + 140]
        parsed, _ = parse_deadline(window)
        if parsed:
            found.append((bool(_STRONG_CUE.match(cue.group(0))), parsed, bool(_EXTENSION.search(window[:70]))))
    # "Deadline: ..." beats "start no later than ... and end by 31 December 2027"
    strong = [f for f in found if f[0]]
    if not strong:
        # Weaker phrases also time travel and project dates ("depart no later than 30 October"):
        # only the first, which is normally the submission date, is trusted
        return [found[0][1]] if found else []
    dates, extended = [f[1] for f in strong], any(f[2] for f in strong)
    if extended:
        return [max(dates)]
    upcoming = sorted({d for d in dates if d >= deadline_engine.today_ist()})
    return upcoming[:MAX_DEADLINES] or [max(dates)]


def _opens_on(text: str) -> date | None:
    """The earliest date the document says submissions open, if it states one."""
    found = [parse_deadline(text[c.end():c.end() + 40])[0] for c in _OPENING_CUE.finditer(text)]
    found = [d for d in found if d]
    return min(found) if found else None


def extract_call_details(text: str) -> dict[str, Any]:
    """Summary, eligibility, budget and deadline text found in a call document."""
    details: dict[str, Any] = {}
    if not text:
        return details
    details["summary"] = text[:SUMMARY_CHARS].rsplit(" ", 1)[0] + ("…" if len(text) > SUMMARY_CHARS else "")
    details["solicitation_guidelines"] = text[:GUIDELINES_CHARS]
    eligibility = _eligibility(text, EXCERPT_CHARS)
    if eligibility:
        details["eligibility_clause"] = eligibility
    budget = _budget(text)
    if budget:
        details["budget"] = budget
    deadline = _deadline_text(text)
    if deadline:
        details["deadline_text"] = deadline
        details["deadline_dates"] = _deadline_dates(text)
    opens = _opens_on(text)
    if opens:
        details["opens_on"] = opens
    if says_closed(text):
        details["closed"] = True
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

        # Only when the listing gave no date: take the ones the document states
        dates = details.get("deadline_dates") or []
        if not any(d.deadline_date for d in opp.deadlines) and dates:
            for dl_date in dates:
                opp.deadlines.append(OpportunityDeadline(
                    deadline_type="full_proposal",
                    deadline_date=dl_date,
                    confidence="probable",
                    raw_text=details["deadline_text"][:200],
                ))
            status = lifecycle_status(opp.title, dates)
            opp.status = "open" if status == "open" else "closed"
            opens = details.get("opens_on")
            if opp.status == "open" and opens and opens > deadline_engine.today_ist():
                opp.status = "forecasted"
                opp.metadata["opens_on"] = opens.isoformat()
        # "Applications have now concluded", unless it names a deadline still ahead (an older round, say)
        today = deadline_engine.today_ist()
        if details.get("closed") and not any(d.deadline_date and d.deadline_date >= today for d in opp.deadlines):
            opp.status = "closed"
    return read
