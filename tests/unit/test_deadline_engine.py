from datetime import date, timedelta

from radar.deadlines import deadline_engine


def test_deadline_urgency_buckets():
    today = deadline_engine.today_ist()
    assert deadline_engine.deadline_urgency(today - timedelta(days=1)) == "closed"
    assert deadline_engine.deadline_urgency(today + timedelta(days=2)) == "critical"
    assert deadline_engine.deadline_urgency(today + timedelta(days=5)) == "urgent"
    assert deadline_engine.deadline_urgency(today + timedelta(days=10)) == "soon"
    assert deadline_engine.deadline_urgency(today + timedelta(days=20)) == "upcoming"
    assert deadline_engine.deadline_urgency(today + timedelta(days=40)) == "distant"

def test_classify_deadline_confidence():
    date_val, conf = deadline_engine.classify_deadline_confidence("2026-10-15")
    assert date_val is not None
    assert date_val.year == 2026
    assert conf == "confirmed"

    date_val2, conf2 = deadline_engine.classify_deadline_confidence("Closing date is 2026-12-31")
    assert date_val2 is not None
    assert conf2 == "probable"


import pytest  # noqa: E402


@pytest.mark.parametrize("raw, expected", [
    ("27-04-2026", date(2026, 4, 27)),          # DBT
    ("31.10.2026", date(2026, 10, 31)),
    ("31/10/2026", date(2026, 10, 31)),
    ("05/11/2026", date(2026, 11, 5)),          # Indian sources are day-first
    ("Oct. 31, 2026", date(2026, 10, 31)),      # ICMR
    ("Sept. 30, 2026", date(2026, 9, 30)),
    ("31st October 2026", date(2026, 10, 31)),
    ("31-Oct-2026", date(2026, 10, 31)),
    ("15 Nov 26", None),                        # two-digit year with month name is too ambiguous
])
def test_parse_indian_formats(raw, expected):
    parsed, confidence = deadline_engine.parse_deadline(raw)
    assert parsed == expected
    assert confidence == ("confirmed" if expected else "unknown")


def test_month_first_hint_for_us_sources():
    assert deadline_engine.parse_deadline("05/11/2026", day_first=False)[0] == date(2026, 5, 11)
    # An unambiguous date is read correctly whatever the hint
    assert deadline_engine.parse_deadline("10/31/2026")[0] == date(2026, 10, 31)


def test_date_inside_prose_is_probable_and_prefers_the_closing_date():
    parsed, confidence = deadline_engine.parse_deadline(
        "Portal opens 01-09-2026. Last date of submission: 15-10-2026 (5 PM IST)"
    )
    assert parsed == date(2026, 10, 15)
    assert confidence == "probable"


def test_invalid_dates_are_rejected():
    assert deadline_engine.parse_deadline("31-02-2026") == (None, "unknown")
    assert deadline_engine.parse_deadline("To be announced") == (None, "unknown")
    assert deadline_engine.parse_deadline(None) == (None, "unknown")


@pytest.mark.parametrize("title", [
    "Results: Special Call for proposals for ICMR Centres",
    "Result: Call for Investigator-Initiated Research Proposals",
    "List of selected proposals under Biotech KISAN",
    "Shortlisted candidates for interview",
])
def test_result_notices(title):
    assert deadline_engine.lifecycle_status(title, [date(2030, 1, 1)]) == "result_notice"


def test_lifecycle_open_closed_unknown():
    today = date(2026, 9, 29)
    assert deadline_engine.lifecycle_status("Call for proposals", [date(2026, 9, 29)], today) == "open"
    assert deadline_engine.lifecycle_status("Call for proposals", [date(2026, 3, 30)], today) == "closed"
    # Any future stage (e.g. full proposal after a past LoI) keeps the call open
    assert deadline_engine.lifecycle_status("Call", [date(2026, 3, 1), date(2026, 12, 1)], today) == "open"
    assert deadline_engine.lifecycle_status("Call for proposals", [None], today) == "unknown"


def test_extension_in_one_sentence_takes_the_new_date():
    assert deadline_engine.parse_deadline("Last date extended from 15.09.2026 to 30.09.2026.")[0] == date(2026, 9, 30)


def test_still_is_not_the_cue_till():
    text = "Applications are still invited from 01-09-2026 and close 30-09-2026"
    assert deadline_engine.parse_deadline(text)[0] == date(2026, 9, 30)


def test_dates_after_the_deadline_clause_are_not_the_deadline():
    text = "Last date of submission: 15-10-2026; results will be announced by 15-12-2026"
    assert deadline_engine.parse_deadline(text)[0] == date(2026, 10, 15)
