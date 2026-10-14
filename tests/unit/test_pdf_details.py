"""Call-document parsing: summary, eligibility, budget and deadline from agency PDFs."""
from datetime import date

import pytest

from radar.models import Opportunity, OpportunityDeadline
from radar.sources import pdf_details

CALL_TEXT = (
    "Department of Biotechnology Ministry of Science and Technology CALL FOR PROPOSALS "
    "Microbiome and Human Health 1. Background The human microbiome shapes immunity and metabolism. "
    "2. Eligibility a. Lead PI: Indian Nationals holding a regular position in a recognised academic "
    "institution. b. PI should not be above 55 years of age. 3. Budget The total funding up to "
    "Rs. 50,00,000 per project for three years. 4. Timeline Last date of submission: 15.11.2026 (5:00 PM)."
)


@pytest.fixture(autouse=True)
def frozen_today(monkeypatch):
    monkeypatch.setattr("radar.deadlines.deadline_engine.today_ist", lambda: date(2026, 9, 29))


def test_extract_call_details():
    details = pdf_details.extract_call_details(CALL_TEXT)
    assert details["summary"].startswith("Department of Biotechnology")
    assert details["eligibility_clause"].startswith("Eligibility a. Lead PI: Indian Nationals")
    assert "55 years" in details["eligibility_clause"]
    assert "Budget" not in details["eligibility_clause"]  # stops at the next numbered heading
    assert details["budget"] == "Rs. 50,00,000"
    assert "15.11.2026" in details["deadline_text"]


def test_extract_from_empty_text():
    assert pdf_details.extract_call_details("") == {}


def _dbt_call(**kwargs) -> Opportunity:
    return Opportunity(
        kind="funding",
        title="Call for proposals: Microbiome and Human Health",
        summary="Call for proposals from DBT",
        agency_or_publisher="DBT",
        source_url="https://dbt.gov.in/storage/media/call.pdf",
        status="unknown",
        **kwargs,
    )


def test_enrich_fills_details_and_missing_deadline(monkeypatch):
    monkeypatch.setattr(pdf_details, "fetch", lambda url, **kw: type("R", (), {"content": b"%PDF"})())
    monkeypatch.setattr(pdf_details, "pdf_text", lambda content: CALL_TEXT)
    opp = _dbt_call()

    assert pdf_details.enrich_with_pdf_details([opp]) == 1
    assert opp.summary.startswith("Department of Biotechnology")
    assert "Indian Nationals" in opp.metadata["eligibility_clause"]
    assert opp.metadata["budget"] == "Rs. 50,00,000"
    assert opp.deadlines[0].deadline_date == date(2026, 11, 15)
    assert opp.deadlines[0].confidence == "probable"
    assert opp.status == "open"


def test_enrich_keeps_listing_deadline(monkeypatch):
    monkeypatch.setattr(pdf_details, "fetch", lambda url, **kw: type("R", (), {"content": b"%PDF"})())
    monkeypatch.setattr(pdf_details, "pdf_text", lambda content: CALL_TEXT)
    listed = OpportunityDeadline(deadline_type="full_proposal", deadline_date=date(2026, 10, 31), confidence="confirmed")
    opp = _dbt_call(deadlines=[listed])

    pdf_details.enrich_with_pdf_details([opp])
    assert opp.deadlines == [listed]


def test_enrich_skips_non_pdf_and_survives_fetch_errors(monkeypatch):
    def boom(url, **kw):
        raise pdf_details.FetchError("HTTP 404")

    monkeypatch.setattr(pdf_details, "fetch", boom)
    html_page = _dbt_call()
    html_page.source_url = "https://anrfonline.in/ANRF/arg_anrf"
    broken_pdf = _dbt_call()

    assert pdf_details.enrich_with_pdf_details([html_page, broken_pdf]) == 0
    assert broken_pdf.summary == "Call for proposals from DBT"


# Real passages from call documents found on 2026-10-14

MOES_TEXT = (
    "Call 1: Advancing understanding, modelling and prediction of extreme events in a changing climate Topic ID: "
    "HORIZON-CL5-2027-01-D1-07 | Type: RIA Opening: 17 November 2026 | Deadline: 4 March 2027 Call 2: Unlocking a safe "
    "operating space for Antarctica and the Southern Ocean Topic ID: HORIZON-CL6-2027-02-CLIMATE-04 | Type: RIA Opening: "
    "20 April 2027 | Deadline: 23 September 2027 Issued by the Ministry of Earth Sciences (MoES) Table of Contents "
    "Introduction ........ 1 Section 2: Eligibility ................................ 2 2.3 Eligibility of European Partners "
    "................ 2 Section 1: Introduction The call co-funds Indian partners. Section 2: Eligibility 2.1 Indian Entities "
    "Eligible for MoES Funding The following categories of Indian entities are eligible: academic institutions and R&D labs."
)


def test_eligibility_skips_contents_lines_and_passing_mentions():
    details = pdf_details.extract_call_details(MOES_TEXT)
    assert details["eligibility_clause"].startswith("Eligibility 2.1 Indian Entities")
    aicte = ("the Institute shall verify the application and approve for eligibility of disbursement of the scholarship. "
             "All eligible candidates shall upload their information on or before 20th October, 2026.")
    assert "eligibility_clause" not in pdf_details.extract_call_details(aicte)


def test_eligibility_keeps_its_numbered_list():
    text = ("*All these programmes will be full time Eligibility :- 1. Must be an Indian citizen. 2. Applicants born after "
            "31st August, 2008 shall not be considered. 3. Must possess at least 60% marks. How to apply Apply online.")
    clause = pdf_details.extract_call_details(text)["eligibility_clause"]
    assert "born after 31st August, 2008" in clause and "60% marks" in clause
    assert "Apply online" not in clause


def test_every_stated_deadline_is_kept_and_opening_date_marks_forecasted(monkeypatch):
    monkeypatch.setattr(pdf_details, "fetch", lambda url, **kw: type("R", (), {"content": b"%PDF"})())
    monkeypatch.setattr(pdf_details, "pdf_text", lambda content: MOES_TEXT)
    opp = _dbt_call()
    pdf_details.enrich_with_pdf_details([opp])
    assert [d.deadline_date for d in opp.deadlines] == [date(2027, 3, 4), date(2027, 9, 23)]
    assert opp.status == "forecasted"  # the first call opens on 17 November 2026
    assert opp.metadata["opens_on"] == "2026-11-17"


def test_extended_deadline_keeps_only_the_new_date(monkeypatch):
    text = "CALL FOR PROPOSALS Last date of submission extended from 15.10.2026 to 31.10.2026. Deadline for hard copy: 31.10.2026."
    monkeypatch.setattr(pdf_details, "fetch", lambda url, **kw: type("R", (), {"content": b"%PDF"})())
    monkeypatch.setattr(pdf_details, "pdf_text", lambda content: text)
    opp = _dbt_call()
    pdf_details.enrich_with_pdf_details([opp])
    assert [d.deadline_date for d in opp.deadlines] == [date(2026, 10, 31)]


def test_document_saying_the_call_has_ended_marks_it_closed(monkeypatch):
    text = "The Globalink Research Internship call for Summer 2027 student applications has now concluded, and we are no longer accepting applications."
    monkeypatch.setattr(pdf_details, "fetch", lambda url, **kw: type("R", (), {"content": b"%PDF"})())
    monkeypatch.setattr(pdf_details, "pdf_text", lambda content: text)
    opp = _dbt_call()
    pdf_details.enrich_with_pdf_details([opp])
    assert opp.status == "closed"


def test_mention_of_an_earlier_round_closing_does_not_close_a_dated_call(monkeypatch):
    text = "The 2025 round has closed. CALL FOR PROPOSALS 2026 Last date of submission: 30.11.2026."
    monkeypatch.setattr(pdf_details, "fetch", lambda url, **kw: type("R", (), {"content": b"%PDF"})())
    monkeypatch.setattr(pdf_details, "pdf_text", lambda content: text)
    opp = _dbt_call()
    pdf_details.enrich_with_pdf_details([opp])
    assert opp.status == "open"


def test_project_dates_do_not_outrank_the_stated_deadline():
    # UGC Indo-Norwegian INCP2 notice: closed on 13 August 2024
    text = ("The deadline for submission of applications is 13th August 2024, 13:00 (UTC). Projects must have planned "
            "start-up no later than 1 November 2024 and be scheduled to end by 31 December 2027.")
    assert pdf_details._deadline_dates(text) == [date(2024, 8, 13)]


def test_later_travel_dates_do_not_replace_the_registration_deadline():
    # UGC notice for the OPCW Symposium on Women in Chemistry: register by 24 April 2026
    text = ("Applicants may create their account and register for the event no later than Friday, 24th April 2026, on "
            "https://apps.opcw.org/eventus. Further information may also be obtained from the International Cooperation "
            "Branch of the Technical Secretariat. Travel: participants must arrive by 27 October and depart no later than "
            "Friday, 30 October 2026.")
    assert pdf_details._deadline_dates(text) == [date(2026, 4, 24)]
