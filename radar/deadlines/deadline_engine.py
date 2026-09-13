"""Stateful deadline classification and urgency calculation engine."""
from datetime import UTC, date, datetime


def deadline_urgency(deadline_date: date, faculty_timezone: str = "Asia/Kolkata") -> str:
    today = datetime.now(UTC).date()
    days_left = (deadline_date - today).days
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

def classify_deadline_confidence(raw_text: str | None) -> tuple[date | None, str]:
    if not raw_text:
        return None, "unknown"
    cleaned = raw_text.strip()
    date_formats = ["%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%B %d, %Y", "%d %b %Y", "%Y/%m/%d"]

    for fmt in date_formats:
        try:
            parsed = datetime.strptime(cleaned, fmt).date()
            return parsed, "confirmed"
        except ValueError:
            pass

    # Try ISO date prefix extraction
    import re
    iso_match = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", cleaned)
    if iso_match:
        try:
            parsed = datetime.strptime(iso_match.group(1), "%Y-%m-%d").date()
            return parsed, "probable"
        except ValueError:
            pass

    return None, "unknown"
