"""Unit tests for Solicitation Eligibility & Compliance Gatekeeper Agent."""
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
    assert any("Office of Sponsored Programs" in act for act in report.action_items)


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

