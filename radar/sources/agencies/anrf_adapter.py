"""Anusandhan National Research Foundation (ANRF, formerly SERB) calls adapter.

anrfonline.in fills its "Ongoing / Upcoming calls" panels from a small JavaScript data file,
``schemeinterval.js``: ``var schemeobj = {"items": [{"1": [name, code, "YYYY/MM/DD hh:mm:ss" start,
end, detail path]}, ...]}``. ``schemeintervalnew.js`` lists programmes open all year (no dates).
"""
import json
import re
from datetime import datetime
from typing import Any

from radar.deadlines.deadline_engine import today_ist
from radar.sources.agency_scraper_base import AgencyAdapter
from radar.sources.http import fetch

BASE = "https://anrfonline.in"
DATED_CALLS_URL = f"{BASE}/ANRF/resources/app_srv/serb/gl/jssrc/schemeinterval.js"
ROLLING_CALLS_URL = f"{BASE}/ANRF/resources/app_srv/serb/gl/jssrc/schemeintervalnew.js"


def parse_scheme_js(text: str) -> list[list[Any]]:
    """The item arrays of a ``var x = {"items": [{"1": [...]}, ...]}`` data file."""
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("no JSON object in scheme file")
    data = json.loads(text[start:end + 1])
    return [values for item in data.get("items", []) for values in item.values()]


def _date(raw: str) -> str | None:
    match = re.match(r"\s*(\d{4})/(\d{1,2})/(\d{1,2})", raw or "")
    if not match:
        return None
    year, month, day = (int(g) for g in match.groups())
    return datetime(year, month, day).date().isoformat()


def _clean(name: str) -> str:
    return " ".join(name.replace("​", "").split())


class ANRFAdapter(AgencyAdapter):
    agency_name = "ANRF"
    url = f"{BASE}/ANRF/HomePage"

    def _fetch_calls(self) -> list[dict[str, Any]]:
        calls: list[dict[str, Any]] = []
        today = today_ist().isoformat()
        seen: set[str] = set()

        for values in parse_scheme_js(fetch(DATED_CALLS_URL).text):
            if len(values) < 5:
                continue
            name, _code, start_raw, end_raw, path = values[:5]
            opens_on, closes_on = _date(start_raw), _date(end_raw)
            if not closes_on or closes_on < today:
                continue  # the file keeps years of history; only current and upcoming calls matter
            title = _clean(name)
            key = f"{title}|{closes_on}"
            if key in seen:
                continue
            seen.add(key)
            calls.append({
                "title": title,
                "url": f"{BASE}{path}" if path and path.startswith("/") else self.url,
                "deadline": closes_on,
                "opens_on": opens_on,
            })

        # Programmes open all year (e.g. International Travel Support). Optional: a failure here
        # shouldn't hide the dated calls above.
        try:
            for values in parse_scheme_js(fetch(ROLLING_CALLS_URL).text):
                if len(values) >= 3 and values[0]:
                    calls.append({
                        "title": _clean(values[0]),
                        "url": f"{BASE}{values[2]}" if str(values[2]).startswith("/") else self.url,
                        "deadline": None,
                        "rolling": True,
                    })
        except Exception:
            pass
        return calls
