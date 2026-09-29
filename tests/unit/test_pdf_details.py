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
