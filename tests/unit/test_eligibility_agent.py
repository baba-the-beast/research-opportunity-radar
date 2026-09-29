"""Unit tests for Solicitation Eligibility & Compliance Gatekeeper Agent."""
from datetime import date

from radar.agents.eligibility_agent import EligibilityAgent
from radar.models import FacultyProfile, Opportunity


def test_early_career_eligible():
    profile = FacultyProfile(
        full_name="Dr. Elena Vance",
        institution="MIT",
        career_stage="Assistant Professor",
        phd_year=2022,
        citizenship_status="US Citizen or Permanent Resident"
    )
    opp = Opportunity(
        kind="funding",
        title="NSF CAREER: Foundation for Cyber-Physical Systems",
        summary="Early career faculty development program for assistant professors.",
        source_url="https://nsf.gov/career",
        metadata={"solicitation_guidelines": "NSF CAREER guidelines: open to tenure-track assistant professors at accredited institutions."}
    )

    agent = EligibilityAgent()
    report = agent.evaluate_opportunity(opp, profile)

    assert report.status == "ELIGIBLE"
    assert report.confidence >= 0.8
    career_check = next((c for c in report.checks if c.rule_name == "CAREER_STAGE_ELIGIBILITY"), None)
    assert career_check is not None
    assert career_check.verdict == "PASS"

def test_career_stage_disqualification():
    profile = FacultyProfile(
        full_name="Dr. Senior Investigator",
        institution="MIT",
        career_stage="Full Professor (Tenured)",
        phd_year=2005
    )
    opp = Opportunity(
        kind="funding",
        title="NSF Early Career Development Award",
        summary="Restricted to early career untenured assistant professors within 7 years of PhD.",
        source_url="https://nsf.gov/career"
    )

    agent = EligibilityAgent()
    report = agent.evaluate_opportunity(opp, profile)

    assert report.status == "DISQUALIFIED"
    career_check = next((c for c in report.checks if c.rule_name == "CAREER_STAGE_ELIGIBILITY"), None)
    assert career_check is not None
    assert career_check.verdict == "FAIL"

def test_citizenship_restriction_disqualification():
    profile = FacultyProfile(
        full_name="Dr. Global Scholar",
        institution="Oxford University",
        career_stage="Assistant Professor",
        citizenship_status="International Scholar (UK National)"
    )
    opp = Opportunity(
        kind="funding",
        title="DoD Defense Advanced Sensor Telemetry",
        summary="Solicitation requiring U.S. citizens only due to ITAR restrictions.",
        source_url="https://dod.gov/solicitation"
    )

    agent = EligibilityAgent()
    report = agent.evaluate_opportunity(opp, profile)

    assert report.status == "DISQUALIFIED"
    cit_check = next((c for c in report.checks if c.rule_name == "CITIZENSHIP_SECURITY_CLEARANCE"), None)
    assert cit_check is not None
    assert cit_check.verdict == "FAIL"

def test_limited_submission_warning():
    profile = FacultyProfile(
        full_name="Dr. Elena Vance",
        institution="MIT",
        career_stage="Assistant Professor",
        citizenship_status="US Citizen or Permanent Resident"
    )
    opp = Opportunity(
        kind="funding",
        title="NSF Major Research Instrumentation (MRI)",
        summary="Limit on number of proposals per organization: 2 per campus. Shared instrumentation grant.",
        source_url="https://nsf.gov/mri",
        metadata={"solicitation_guidelines": "NSF Major Research Instrumentation program guidelines."}
    )

    agent = EligibilityAgent()
    report = agent.evaluate_opportunity(opp, profile)

    assert report.status == "WARNING_LIMITED_SUBMISSION"
    lim_check = next((c for c in report.checks if c.rule_name == "LIMITED_SUBMISSION_QUOTA"), None)
    assert lim_check is not None
    assert lim_check.verdict == "WARNING"
    assert any("Office of Sponsored Research" in act for act in report.action_items)


def test_citizenship_unverified_requires_manual_review():
    """Verifies that an opportunity with only title and short summary (no guidelines) produces NEEDS_MANUAL_REVIEW."""
    profile = FacultyProfile(
        full_name="Dr. Vibha",
        institution="COEP Technological University",
        career_stage="Associate Professor",
        citizenship_status="Citizen of India"
    )
    # DoD/export-control-adjacent title with no solicitation_guidelines or eligibility_clause
    opp = Opportunity(
        kind="funding",
        title="Tactical Behaviors for Autonomous Maneuver",
        summary="Research initiative exploring autonomous multi-agent ground tactical maneuvering.",
        source_url="https://grants.gov/search-results-detail/12345"
    )

    agent = EligibilityAgent()
    report = agent.evaluate_opportunity(opp, profile)

    assert report.status == "NEEDS_MANUAL_REVIEW"
    cit_check = next((c for c in report.checks if c.rule_name == "CITIZENSHIP_SECURITY_CLEARANCE"), None)
    assert cit_check is not None
    assert cit_check.verdict == "NEEDS_MANUAL_REVIEW"
    assert "could not be verified" in cit_check.reason
    assert any("solicitation" in act.lower() for act in report.action_items)



# --- Indian call rules -------------------------------------------------------------------------
import pytest  # noqa: E402

from radar.agents.eligibility_agent import indian_nationality  # noqa: E402


@pytest.fixture
def frozen_today(monkeypatch):
    monkeypatch.setattr("radar.agents.eligibility_agent.today_ist", lambda: date(2026, 9, 29))


def _indian_call(eligibility: str, title: str = "Call for proposals: Microbiome research") -> Opportunity:
    return Opportunity(kind="funding", title=title, summary="DBT call", source_url="https://dbt.gov.in/c.pdf",
                       metadata={"eligibility_clause": eligibility})


def _faculty(**kwargs) -> FacultyProfile:
    defaults = dict(full_name="Dr. A", institution="IIT Guwahati", citizenship_status="Indian citizen",
                    designation="Assistant Professor", employment_type="regular")
    return FacultyProfile(**{**defaults, **kwargs})


def _check(report, rule):
    return next(c for c in report.checks if c.rule_name == rule)


@pytest.mark.parametrize("text, expected", [
    ("Indian citizen", "indian"), ("Citizen of India", "indian"), ("OCI card holder", "oci"),
    ("UK national", "foreign"), ("US Citizen or Permanent Resident", "foreign"), ("", None),
])
def test_indian_nationality(text, expected):
    assert indian_nationality(text) == expected


def test_indian_nationals_only(frozen_today):
    call = _indian_call("Eligibility: Lead PI must be an Indian National holding a regular position.")
    agent = EligibilityAgent()
    assert agent.evaluate_opportunity(call, _faculty()).status == "ELIGIBLE"
    assert agent.evaluate_opportunity(call, _faculty(citizenship_status="German citizen")).status == "DISQUALIFIED"
    oci = agent.evaluate_opportunity(call, _faculty(citizenship_status="OCI"))
    assert oci.status == "NEEDS_MANUAL_REVIEW"
    # The excerpt is quoted from the call, not invented
    assert "Indian National" in _check(oci, "CITIZENSHIP_SECURITY_CLEARANCE").solicitation_excerpt


def test_age_limit_with_relaxation_band(frozen_today):
    call = _indian_call("The applicant should be below 45 years of age as on the last date.")
    agent = EligibilityAgent()
    assert agent.evaluate_opportunity(call, _faculty(date_of_birth=date(1985, 1, 1))).status == "ELIGIBLE"
    assert agent.evaluate_opportunity(call, _faculty(date_of_birth=date(1979, 6, 1))).status == "NEEDS_MANUAL_REVIEW"
    assert agent.evaluate_opportunity(call, _faculty(date_of_birth=date(1970, 1, 1))).status == "DISQUALIFIED"
    unknown = agent.evaluate_opportunity(call, _faculty())
    assert unknown.status == "NEEDS_MANUAL_REVIEW"
    assert any("date of birth" in a for a in unknown.action_items)


def test_years_to_superannuation(frozen_today):
    call = _indian_call("The PI should have at least 3 years of service before superannuation.")
    agent = EligibilityAgent()
    assert agent.evaluate_opportunity(call, _faculty(superannuation_year=2035)).status == "ELIGIBLE"
    assert agent.evaluate_opportunity(call, _faculty(superannuation_year=2027)).status == "DISQUALIFIED"


def test_regular_position_required(frozen_today):
    call = _indian_call("Applicants must hold a regular position in a recognised institution.")
    agent = EligibilityAgent()
    assert agent.evaluate_opportunity(call, _faculty(employment_type="contractual")).status == "DISQUALIFIED"
    assert agent.evaluate_opportunity(call, _faculty(employment_type=None)).status == "NEEDS_MANUAL_REVIEW"


def test_north_east_only_calls(frozen_today):
    call = _indian_call("This call is only for scientists working in the North Eastern Region of India.")
    agent = EligibilityAgent()
    assert agent.evaluate_opportunity(call, _faculty(state="Assam")).status == "ELIGIBLE"
    assert agent.evaluate_opportunity(call, _faculty(state="Maharashtra")).status == "DISQUALIFIED"


def test_phd_window(frozen_today):
    call = _indian_call("Open to researchers within 7 years of the award of PhD.")
    agent = EligibilityAgent()
    assert agent.evaluate_opportunity(call, _faculty(phd_year=2022)).status == "ELIGIBLE"
    assert agent.evaluate_opportunity(call, _faculty(phd_year=2010)).status == "DISQUALIFIED"


def test_missing_designation_means_manual_review_not_disqualified(frozen_today):
    agent = EligibilityAgent()
    senior_call = _indian_call("This scheme is for full professors only.")
    report = agent.evaluate_opportunity(senior_call, _faculty(designation=None, career_stage=""))
    assert report.status == "NEEDS_MANUAL_REVIEW"
    assert any("designation" in a for a in report.action_items)
    early_call = _indian_call("Details in the guidelines.", title="Prime Minister Early Career Research Grant")
    assert agent.evaluate_opportunity(early_call, _faculty(designation=None, career_stage="", phd_year=None)).status == "NEEDS_MANUAL_REVIEW"


def test_calls_for_papers_are_not_checked():
    cfp = Opportunity(kind="venue", title="CFP: ICML 2027", source_url="http://www.wikicfp.com/x")
    report = EligibilityAgent().evaluate_opportunity(cfp, _faculty(citizenship_status=""))
    assert report.status == "ELIGIBLE" and report.checks == []


def test_no_invented_excerpts_or_full_verification_claims(frozen_today):
    call = _indian_call("Proposals are invited from faculty of recognised institutions across India.")
    report = EligibilityAgent().evaluate_opportunity(call, _faculty())
    assert report.status == "ELIGIBLE"
    assert "verified" not in report.summary.lower()
    assert all(c.solicitation_excerpt is None or c.solicitation_excerpt.lower() in (call.title + " " + call.summary + " " + call.metadata["eligibility_clause"]).lower()
               for c in report.checks)


def test_passing_mention_of_young_researchers_is_not_a_restriction(frozen_today):
    call = _indian_call("About 400 medical faculties and young researchers from these states will be trained in systematic reviews.",
                        title="SARANSH-3: Call for Expression of Interest")
    report = EligibilityAgent().evaluate_opportunity(call, _faculty(designation="Professor", phd_year=2002))
    assert report.status != "DISQUALIFIED"


def test_early_career_scheme_by_title(frozen_today):
    call = _indian_call("Details in the guidelines.", title="Prime Minister Early Career Research Grant")
    assert EligibilityAgent().evaluate_opportunity(call, _faculty(designation="Professor", phd_year=2002)).status == "DISQUALIFIED"
