"""Deadline parsing, lifecycle classification and urgency calculation.

Indian agency pages publish dates in day-first numeric forms (27-04-2026, 31.10.2026, 31/10/2026) and
abbreviated month forms ("Oct. 31, 2026", "Sept. 30, 2026", "31st October 2026"). US sources such as
Grants.gov use month-first numerics (10/31/2026); callers pass ``day_first=False`` for those.
"""
import re
from collections.abc import Iterable
from datetime import date, datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30), "Asia/Kolkata")

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
_MONTH_RE = (
    r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|"
    r"sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
)
_ORD = r"(?:\s?(?:st|nd|rd|th)\b)?"  # "31st", also "10 th" as some PDFs extract it

# Each pattern yields named groups d, m (number or month name) and y.
_DATE_PATTERNS = [
    re.compile(r"\b(?P<y>\d{4})-(?P<m>\d{1,2})-(?P<d>\d{1,2})\b"),                        # 2026-10-31 (ISO)
    re.compile(r"\b(?P<a>\d{1,2})[./-](?P<b>\d{1,2})[./-](?P<y>\d{4}|\d{2})\b"),           # 31-10-2026 / 10/31/26
    re.compile(rf"\b(?P<d>\d{{1,2}}){_ORD}[\s-]*(?:of\s+)?(?P<m>{_MONTH_RE})\.?,?[\s-]*(?P<y>\d{{4}})\b", re.I),
    re.compile(rf"\b(?P<m>{_MONTH_RE})\.?\s+(?P<d>\d{{1,2}}){_ORD},?\s+(?P<y>\d{{4}})\b", re.I),
]

# Phrases that introduce the closing date inside longer text
_DEADLINE_CUE = re.compile(
    r"(last\s+date|deadline|closing\s+date|cut-?\s?off\s+date|closes\s+on|due\s+date|submission\s+(?:date|deadline)|"
    r"apply\s+(?:by|before)|on\s+or\s+before|till|until)",
    re.I,
)

# Titles that announce outcomes of a call, not a call that can be applied to
_RESULT_NOTICE = re.compile(
    r"^\W*(results?|outcome|list\s+of\s+(?:selected|shortlisted|recommended|sanctioned)|"
    r"selected\s+(?:proposals|candidates|projects)|shortlisted|sanctioned\s+projects)\b",
    re.I,
)


def today_ist() -> date:
    """Today's date in India. Faculty and agency deadlines are Indian calendar dates."""
    return datetime.now(IST).date()


def deadline_urgency(deadline_date: date, faculty_timezone: str = "Asia/Kolkata") -> str:
    days_left = (deadline_date - today_ist()).days
    if days_left < 0:
        return "closed"
    elif days_left <= 3:
        return "critical"
    elif days_left <= 7:
        return "urgent"
    elif days_left <= 14:
        return "soon"
    elif days_left <= 30:
        return "upcoming"
    else:
        return "distant"


def _build_date(match: re.Match[str], day_first: bool) -> date | None:
    groups = match.groupdict()
    year = int(groups["y"])
    if year < 100:
        year += 2000
    if groups.get("a") is not None:
        first, second = int(groups["a"]), int(groups["b"])
        if first > 12 and second <= 12:
            day, month = first, second
        elif second > 12 and first <= 12:
            day, month = second, first
        else:
            day, month = (first, second) if day_first else (second, first)
    else:
        raw_month = groups["m"]
        month = int(raw_month) if raw_month.isdigit() else _MONTHS[raw_month[:3].lower()]
        day = int(groups["d"])
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _find_dates(text: str, day_first: bool) -> list[tuple[int, int, date]]:
    """All (start, end, date) triples in text, without overlapping matches."""
    found: list[tuple[int, int, date]] = []
    for pattern in _DATE_PATTERNS:
        for match in pattern.finditer(text):
            if any(start <= match.start() < end for start, end, _ in found):
                continue
            parsed = _build_date(match, day_first)
            if parsed:
                found.append((match.start(), match.end(), parsed))
    return sorted(found)


def parse_deadline(raw_text: str | None, day_first: bool = True) -> tuple[date | None, str]:
    """Parse a deadline from a date cell or a sentence.

    Returns (date, confidence): "confirmed" when the text is just a date, "probable" when the date was
    picked out of longer text, and (None, "unknown") when there is no usable date. With several dates,
    the one after a cue such as "last date" wins, otherwise the latest one (closing dates follow opening
    dates in agency notices).
    """
    if not raw_text:
        return None, "unknown"
    text = " ".join(str(raw_text).split())
    dates = _find_dates(text, day_first)
    if not dates:
        return None, "unknown"

    if len(dates) == 1:
        start, end, parsed = dates[0]
        # A bare date cell ("31-10-2026", "Oct. 31, 2026") is confirmed; a date inside prose is not
        is_bare = not re.search(r"\w", text[:start] + text[end:])
        return parsed, "confirmed" if is_bare else "probable"

    cues = [m.end() for m in _DEADLINE_CUE.finditer(text)]
    for cue_end in reversed(cues):
        after = [parsed for start, _, parsed in dates if start >= cue_end]
        if after:
            return after[0], "probable"
    return max(parsed for _, _, parsed in dates), "probable"


def classify_deadline_confidence(raw_text: str | None, day_first: bool = True) -> tuple[date | None, str]:
    """Backward-compatible name for parse_deadline."""
    return parse_deadline(raw_text, day_first=day_first)


def is_result_notice(title: str | None) -> bool:
    """True for "Results: …", "List of selected proposals …" and similar outcome announcements."""
    return bool(title and _RESULT_NOTICE.search(title))


def lifecycle_status(title: str | None, deadline_dates: Iterable[date | None], today: date | None = None) -> str:
    """Classify a call as open, closed, result_notice or unknown (no usable deadline)."""
    if is_result_notice(title):
        return "result_notice"
    known = [d for d in deadline_dates if d]
    if not known:
        return "unknown"
    today = today or today_ist()
    return "open" if max(known) >= today else "closed"
