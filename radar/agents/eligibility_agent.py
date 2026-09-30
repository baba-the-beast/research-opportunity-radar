"""Eligibility check for funding calls.

Reads the call's text (title, summary, and the eligibility/guideline excerpts pulled from its PDF)
and compares the restrictions it states with the faculty profile. Rules cover what Indian calls
usually restrict on (nationality, age limit, years to superannuation, regular position, region,
years since PhD) plus U.S.-person restrictions for U.S. sources.

Every excerpt in a report is quoted from the call text. When the call text is missing, or the
profile lacks the field a rule needs, the verdict is NEEDS_MANUAL_REVIEW, never a silent pass.
Calls for papers are open to any author and are not checked.
"""
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any

from radar.deadlines.deadline_engine import today_ist
from radar.models import FacultyProfile, Opportunity

# Order matters in us_person_status(): an explicit negation ("Non-US citizen", "not a U.S. national")
# must win over the U.S. match it contains, and "American" only counts on its own, not inside
# "Latin American" / "South American". Plain substring checks previously also treated "Australian"
# (contains "us") and "Indian Citizen" (contains "citizen") as U.S. persons.
_US_TERM = r"(?:u\.?s\.?a?|united states|american)"
_NEGATED_US_PATTERN = re.compile(rf"\b(?:non|not)(?:[\s-]+an?)?[\s-]*{_US_TERM}\b")
_US_PERSON_PATTERNS = [
    re.compile(p) for p in (
        r"\bu\.?s\.?a?\b",            # US, U.S., USA
        r"\bunited states\b",
        r"(?<!latin )(?<!south )(?<!central )(?<!north )\bamerican\b",
        r"\bgreen card\b",
        r"\bsecurity clearance\b",   # U.S. clearances require U.S. citizenship
        r"\b(dod|darpa)\b",
    )
]
_NON_US_PATTERNS = [
    re.compile(p) for p in (
        r"\bforeign national\b",
        r"\binternational\b",
        r"\boci\b",
        r"\b(indian|india|uk|british|canadian|chinese|german|french|australian|japanese)\b",
        r"\b(latin|south|central) american\b",
        r"\bnational of\b",
        r"\bcitizen of\b",
        r"\bvisa\b",
    )
]

NE_STATES = {"arunachal pradesh", "assam", "manipur", "meghalaya", "mizoram", "nagaland", "sikkim", "tripura"}


def us_person_status(citizenship: str) -> bool | None:
    """True if the profile states U.S. citizenship/permanent residency, False if it states another
    nationality or negates U.S. status, None if ambiguous (e.g. the schema default 'citizen')."""
    text = (citizenship or "").lower()
    if _NEGATED_US_PATTERN.search(text):
        return False
    if any(p.search(text) for p in _US_PERSON_PATTERNS):
        return True
    if any(p.search(text) for p in _NON_US_PATTERNS):
        return False
    return None


def indian_nationality(citizenship: str) -> str | None:
    """'indian', 'oci' (Overseas Citizen of India / PIO), 'foreign', or None when unstated."""
    text = (citizenship or "").lower()
    if re.search(r"\b(oci|overseas citizen|pio|person of indian origin)\b", text) and not re.search(r"\bindian (citizen|national)\b", text):
        return "oci"
    if re.search(r"\bnon[\s-]*indian\b", text):
        return "foreign"
    if re.search(r"\b(indian|india)\b", text):
        return "indian"
    if us_person_status(text) or re.search(r"\b(foreign|international)\b", text):
        return "foreign"
    if re.search(r"\b(citizen|national|nationality|passport)\b", text):
        # "German citizen", "UK national": a stated, non-Indian nationality. A bare "citizen" (old
        # schema default) says nothing about which country.
        qualifier = re.sub(r"\b(citizens?|nationals?|nationality|passport|holder|of|an?|the|permanent|resident)\b", " ", text)
        if re.search(r"[a-z]{2,}", qualifier):
            return "foreign"
    return None


# --- Restrictions as they appear in Indian call documents -------------------------------------
_INDIAN_ONLY = re.compile(r"\b(indian (?:nationals?|citizens?)|(?:citizens?|nationals?) of india)\b", re.I)
# Age limits must say "age" (or "years of age" / "years old"): "not more than 10 years of experience"
# or "should not exceed 03 years" (project length) are not age limits.
_LIMIT_WORDS = r"(?:not\s+(?:be\s+)?(?:above|more\s+than|older\s+than|exceed(?:ing)?)|below|under|less\s+than|up\s*to)"
# A maximum age needs an "upper/maximum age" or "age limit" phrase, or a limiting word before the
# number ("age should not be more than 40 years", "below 35 years of age"). "Minimum age of 25 years"
# and "average age 30 years" are not maximum ages.
_AGE_LIMIT = re.compile(
    rf"\b(?:upper\s+age(?:\s+limit)?|maximum\s+age(?:\s+limit)?|(?<!minimum\s)(?<!average\s)(?<!mean\s)age\s+limit)"
    rf"(?:\s+(?:of|is|for\s+\w+))?\s*:?\s*(?:{_LIMIT_WORDS}\s*)?(\d{{2}})\s*(?:years|yrs)"
    rf"|(?<!minimum\s)(?<!average\s)(?<!mean\s)\bage(?:\s+(?:should|must|shall)(?:\s+be)?)?\s*:?\s*{_LIMIT_WORDS}\s*(\d{{2}})\s*(?:years|yrs)"
    rf"|\b{_LIMIT_WORDS}\s*(\d{{2}})\s*(?:years|yrs)\s*(?:of\s+age|old)\b",
    re.I,
)
# Years left before superannuation must name superannuation/retirement: "a minimum of 5 years of
# regular service in the institution" is an experience requirement, not a years-left one.
_SERVICE_LEFT = re.compile(
    r"\b(?:at\s+least|minimum(?:\s+of)?|not\s+less\s+than)\s*(\d{1,2})\s*years?\s*(?:of\s+)?(?:regular\s+)?"
    r"(?:service\s+)?(?:left\s+|remaining\s+)?(?:before|prior\s+to|till|until|for)\s+(?:the\s+)?(?:(?:date\s+of\s+)?superannuation|retirement)",
    re.I,
)
_REGULAR_POSITION = re.compile(r"\bregular (?:position|faculty|employee|appointment|basis|post)\b", re.I)
_NE_ONLY = re.compile(r"\b(?:only|exclusively|restricted)\b[^.]{0,40}\bnorth[\s-]*east(?:ern)?\s*(?:region|states)\b", re.I)
_PHD_WINDOW = re.compile(r"\bwithin\s*(\d{1,2})\s*years\s*(?:of|after|from)\s*(?:the\s*)?(?:award of\s*)?(?:their\s*)?(?:ph\.?\s*d|doctoral)", re.I)
_EARLY_CAREER = re.compile(r"\b(early[\s-]career|young (?:scientist|investigator|researcher)s?|new investigator|start[\s-]?up research grant)\b", re.I)
_SENIOR_ONLY = re.compile(r"\b(senior investigator|tenured faculty only|distinguished (?:chair|professor)|full professors? only)\b", re.I)
_US_ONLY = re.compile(
    r"(u\.s\. citizens only|us citizens only|united states citizens? only|itar restricted|secret clearance required|"
    r"u\.s\. national or permanent resident|us persons? only|u\.s\. persons? only)",
    re.I,
)
_LIMITED_SUBMISSION = re.compile(
    r"(limit on number of proposals per organization:\s*(\d+)|institutions? may submit no more than\s*(\d+)|limited submission|"
    r"maximum of\s*(\d+)\s*proposals?\s*per\s*institution|only\s*(\d+|one|two)\s*proposals?\s*(?:per|from each|from an?)\s*(?:campus|institution|organisation|organization))",
    re.I,
)
_COST_SHARING = re.compile(r"(cost[\s-]sharing is (?:required|mandatory)|mandatory cost match|matching (?:contribution|share) (?:is )?(?:required|mandatory))", re.I)


def _excerpt(text: str, match: re.Match[str], width: int = 160) -> str:
    """The sentence around a match (at most ~width chars each side), quoted from the call text."""
    start = max(text.rfind(".", 0, match.start()) + 1, match.start() - width)
    if start > 0 and text[start - 1].isalnum():
        start = text.find(" ", start) + 1 or start  # don't start mid-word
    end_dot = text.find(".", match.end())
    end = min(end_dot + 1 if end_dot != -1 else len(text), match.end() + width)
    if end < len(text) and text[end - 1].isalnum():
        end = text.rfind(" ", match.end(), end) if text.rfind(" ", match.end(), end) > 0 else end
    return " ".join(text[start:end].split())


_RESTRICTIVE_CUE = re.compile(r"\b(only|exclusively|restricted|eligible|open to|meant for|intended for|must be|should be|applicants? (?:are|should be))\b[^.]{0,60}$", re.I)


def _early_career_restriction(text: str, title: str) -> re.Match[str] | None:
    """An early-career requirement, not a passing mention ("faculty and young researchers will be
    trained"): the call itself is an early-career scheme, or a restrictive phrase leads into it."""
    title_match = _EARLY_CAREER.search(title)
    if title_match:
        return _EARLY_CAREER.search(text)
    for match in _EARLY_CAREER.finditer(text):
        if _RESTRICTIVE_CUE.search(text[max(0, match.start() - 80):match.start()]):
            return match
    return None


def _is_senior(stage: str) -> bool:
    """Associate Professor and above, in Indian and US titles ('Professor' alone is the senior rank;
    'Assistant Professor' is not). Scientists E-H count as senior."""
    stage = stage.lower().strip()
    if "assistant" in stage:
        return False
    return bool(re.search(r"\b(associate|full professor|professor|emeritus|tenured|senior|head|dean|scientist[\s-]*[e-h])\b", stage))


def _age_on(dob: date, on: date) -> int:
    return on.year - dob.year - ((on.month, on.day) < (dob.month, dob.day))


@dataclass
class ComplianceCheckResult:
    rule_name: str
    verdict: str  # PASS, FAIL, WARNING, NEEDS_MANUAL_REVIEW
    reason: str
    solicitation_excerpt: str | None = None

@dataclass
class EligibilityReport:
    status: str  # ELIGIBLE, WARNING_LIMITED_SUBMISSION, NEEDS_MANUAL_REVIEW, DISQUALIFIED
    confidence: float
    summary: str
    checks: list[ComplianceCheckResult] = field(default_factory=list)
    action_items: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "confidence": round(self.confidence, 2),
            "summary": self.summary,
            "checks": [
                {
                    "rule_name": c.rule_name,
                    "verdict": c.verdict,
                    "reason": c.reason,
                    "solicitation_excerpt": c.solicitation_excerpt
                }
                for c in self.checks
            ],
            "action_items": self.action_items
        }


class EligibilityAgent:
    """Checks a funding call's stated restrictions against one faculty profile."""

    def __init__(self, telemetry_callback: Callable[[dict[str, Any]], None] | None = None):
        self.telemetry_callback = telemetry_callback

    def _emit(self, opp: Opportunity, report: EligibilityReport) -> None:
        if self.telemetry_callback:
            self.telemetry_callback({
                "agent": "EligibilityAgent",
                "phase": "COMPLIANCE_COMPLETE",
                "message": f"Eligibility for '{opp.title[:60]}': {report.status}",
                "payload": {"opp_id": opp.id, "verdict": report.status},
                "timestamp": datetime.now(UTC).isoformat()
            })

    def evaluate_opportunity(self, opp: Opportunity, profile: FacultyProfile) -> EligibilityReport:
        if opp.kind != "funding":
            report = EligibilityReport(
                status="ELIGIBLE", confidence=0.9,
                summary="Calls for papers are open to all authors; no eligibility check needed.",
            )
            opp.metadata["eligibility_report"] = report.to_dict()
            return report

        meta = opp.metadata or {}
        guidelines = " ".join(str(meta.get(k) or "") for k in ("eligibility_clause", "solicitation_guidelines"))
        text = " ".join([opp.title, opp.summary or "", guidelines])
        has_call_text = bool(guidelines.strip())

        checks: list[ComplianceCheckResult] = []
        actions: list[str] = []
        reference_day = opp.earliest_confirmed_deadline() or today_ist()

        self._check_nationality(text, has_call_text, profile, checks, actions)
        self._check_age(text, profile, reference_day, checks, actions)
        self._check_service_left(text, profile, reference_day, checks, actions)
        self._check_regular_position(text, profile, checks, actions)
        self._check_region(text, profile, checks, actions)
        # The scheme's own identity: its title and the first sentence of its summary
        identity = opp.title + " " + (opp.summary or "").split(".")[0]
        self._check_career_stage(text, identity, profile, checks, actions)
        has_limited = self._check_limited_submission(text, checks, actions)
        self._check_cost_sharing(text, checks, actions)

        verdicts = {c.verdict for c in checks}
        if "FAIL" in verdicts:
            failed = [c.rule_name.replace("_", " ").lower() for c in checks if c.verdict == "FAIL"]
            report = EligibilityReport("DISQUALIFIED", 0.9, f"Not eligible: the call's {', '.join(failed)} requirement is not met.", checks, actions)
        elif "NEEDS_MANUAL_REVIEW" in verdicts:
            report = EligibilityReport(
                "NEEDS_MANUAL_REVIEW", 0.6,
                "Eligibility unconfirmed: check the points below against the official call before applying.", checks, actions,
            )
        elif has_limited:
            report = EligibilityReport(
                "WARNING_LIMITED_SUBMISSION", 0.8,
                "Eligible, but the institution can forward only a limited number of proposals: get an internal nomination.",
                checks, actions,
            )
        else:
            report = EligibilityReport(
                "ELIGIBLE", 0.8 if has_call_text else 0.6,
                "No eligibility barrier found in the call text. Confirm with the official call document.", checks, actions,
            )

        self._emit(opp, report)
        opp.metadata["eligibility_report"] = report.to_dict()
        return report

    # --- rules ------------------------------------------------------------------------------------

    def _check_nationality(self, text, has_call_text, profile, checks, actions) -> None:
        citizenship = profile.citizenship_status or ""
        us_only = _US_ONLY.search(text)
        indian_only = _INDIAN_ONLY.search(text)

        if us_only:
            us_person = us_person_status(citizenship)
            excerpt = _excerpt(text, us_only)
            if us_person is None:
                checks.append(ComplianceCheckResult("CITIZENSHIP_SECURITY_CLEARANCE", "NEEDS_MANUAL_REVIEW",
                    f"The call is restricted to U.S. persons; the profile's citizenship ('{citizenship}') does not say whether that is met.", excerpt))
                actions.append("Set your citizenship in Profile to confirm nationality-restricted calls.")
            elif us_person:
                checks.append(ComplianceCheckResult("CITIZENSHIP_SECURITY_CLEARANCE", "PASS",
                    f"Citizenship '{citizenship}' meets the U.S.-person requirement.", excerpt))
            else:
                checks.append(ComplianceCheckResult("CITIZENSHIP_SECURITY_CLEARANCE", "FAIL",
                    f"The call is restricted to U.S. persons; the profile says '{citizenship}'.", excerpt))
            return

        if indian_only:
            nationality = indian_nationality(citizenship)
            excerpt = _excerpt(text, indian_only)
            if nationality == "indian":
                checks.append(ComplianceCheckResult("CITIZENSHIP_SECURITY_CLEARANCE", "PASS", "The call requires Indian nationals; the profile is Indian.", excerpt))
            elif nationality == "foreign":
                checks.append(ComplianceCheckResult("CITIZENSHIP_SECURITY_CLEARANCE", "FAIL",
                    f"The call requires Indian nationals; the profile says '{citizenship}'.", excerpt))
            else:
                # OCI holders are eligible for some schemes and not others; unstated citizenship is unknown
                checks.append(ComplianceCheckResult("CITIZENSHIP_SECURITY_CLEARANCE", "NEEDS_MANUAL_REVIEW",
                    f"The call requires Indian nationals; eligibility for '{citizenship or 'unstated citizenship'}' must be checked in the call.", excerpt))
                actions.append("Confirm whether OCI/PIO applicants are eligible, or set your citizenship in Profile.")
            return

        if not has_call_text:
            checks.append(ComplianceCheckResult("CITIZENSHIP_SECURITY_CLEARANCE", "NEEDS_MANUAL_REVIEW",
                "Nationality and position restrictions could not be verified: only the title and summary were available."))
            actions.append("Read the eligibility section of the official solicitation document.")

    def _check_age(self, text, profile, on, checks, actions) -> None:
        match = _AGE_LIMIT.search(text)
        if not match:
            return
        limit = int(next(g for g in match.groups() if g))
        excerpt = _excerpt(text, match)
        dob = profile.date_of_birth
        if not dob:
            checks.append(ComplianceCheckResult("AGE_LIMIT", "NEEDS_MANUAL_REVIEW", f"The call has an age limit of {limit}; add your date of birth to check it.", excerpt))
            actions.append("Add your date of birth in Profile so age limits can be checked.")
            return
        age = _age_on(dob, on)
        if age <= limit:
            checks.append(ComplianceCheckResult("AGE_LIMIT", "PASS", f"Age {age} is within the limit of {limit}.", excerpt))
        elif age <= limit + 5:
            # Government schemes commonly relax age limits by up to 5 years (SC/ST/women/PwD)
            checks.append(ComplianceCheckResult("AGE_LIMIT", "NEEDS_MANUAL_REVIEW",
                f"Age {age} is above the limit of {limit}; check whether an age relaxation applies to you.", excerpt))
            actions.append(f"Check the call's age-relaxation rules (limit {limit}, your age {age}).")
        else:
            checks.append(ComplianceCheckResult("AGE_LIMIT", "FAIL", f"Age {age} is above the limit of {limit}.", excerpt))

    def _check_service_left(self, text, profile, on, checks, actions) -> None:
        match = _SERVICE_LEFT.search(text)
        if not match:
            return
        required = int(match.group(1))
        excerpt = _excerpt(text, match)
        if not profile.superannuation_year:
            checks.append(ComplianceCheckResult("SERVICE_BEFORE_SUPERANNUATION", "NEEDS_MANUAL_REVIEW",
                f"The call needs at least {required} years of service left; add your superannuation year to check it.", excerpt))
            actions.append("Add your superannuation (retirement) year in Profile.")
            return
        years_left = profile.superannuation_year - on.year
        verdict = "PASS" if years_left >= required else "FAIL"
        checks.append(ComplianceCheckResult("SERVICE_BEFORE_SUPERANNUATION", verdict,
            f"{years_left} years of service left; the call needs {required}.", excerpt))

    def _check_regular_position(self, text, profile, checks, actions) -> None:
        match = _REGULAR_POSITION.search(text)
        if not match:
            return
        excerpt = _excerpt(text, match)
        employment = (profile.employment_type or "").lower()
        if employment == "regular":
            checks.append(ComplianceCheckResult("REGULAR_POSITION", "PASS", "The call needs a regular position; the profile says regular.", excerpt))
        elif employment in ("contract", "contractual", "adhoc", "ad-hoc", "visiting", "guest"):
            checks.append(ComplianceCheckResult("REGULAR_POSITION", "FAIL", f"The call needs a regular position; the profile says '{employment}'.", excerpt))
        else:
            checks.append(ComplianceCheckResult("REGULAR_POSITION", "NEEDS_MANUAL_REVIEW", "The call needs a regular (permanent) position; set your employment type in Profile.", excerpt))
            actions.append("Set your employment type (regular / contractual) in Profile.")

    def _check_region(self, text, profile, checks, actions) -> None:
        match = _NE_ONLY.search(text)
        if not match:
            return
        excerpt = _excerpt(text, match)
        state = (profile.state or "").strip().lower()
        if not state:
            checks.append(ComplianceCheckResult("REGION", "NEEDS_MANUAL_REVIEW", "The call is only for institutions in the North-Eastern Region; add your state in Profile.", excerpt))
            actions.append("Add your institution's state in Profile.")
        elif state in NE_STATES:
            checks.append(ComplianceCheckResult("REGION", "PASS", f"Institution is in {profile.state} (North-Eastern Region).", excerpt))
        else:
            checks.append(ComplianceCheckResult("REGION", "FAIL", f"The call is only for the North-Eastern Region; the institution is in {profile.state}.", excerpt))

    def _check_career_stage(self, text, title, profile, checks, actions) -> None:
        stage = (profile.designation or profile.career_stage or "").lower()
        phd_window = _PHD_WINDOW.search(text)
        if phd_window:
            limit = int(phd_window.group(1))
            excerpt = _excerpt(text, phd_window)
            if not profile.phd_year:
                checks.append(ComplianceCheckResult("CAREER_STAGE_ELIGIBILITY", "NEEDS_MANUAL_REVIEW", f"The call is for researchers within {limit} years of their PhD; add your PhD year.", excerpt))
                actions.append("Add your PhD year in Profile.")
            else:
                years = today_ist().year - profile.phd_year
                checks.append(ComplianceCheckResult("CAREER_STAGE_ELIGIBILITY", "PASS" if years <= limit else "FAIL",
                    f"{years} years since PhD; the call allows up to {limit}.", excerpt))
            return

        early = _early_career_restriction(text, title)
        if early:
            excerpt = _excerpt(text, early)
            if not stage.strip() and not profile.phd_year:
                checks.append(ComplianceCheckResult("CAREER_STAGE_ELIGIBILITY", "NEEDS_MANUAL_REVIEW",
                    "The call is for early-career researchers; add your designation or PhD year to check it.", excerpt))
                actions.append("Set your designation and PhD year in Profile.")
                return
            senior = _is_senior(stage)
            recent_phd = bool(profile.phd_year) and today_ist().year - profile.phd_year <= 7
            if senior and not recent_phd:
                checks.append(ComplianceCheckResult("CAREER_STAGE_ELIGIBILITY", "FAIL", f"The call is for early-career researchers; the profile says '{stage}'.", excerpt))
            else:
                checks.append(ComplianceCheckResult("CAREER_STAGE_ELIGIBILITY", "PASS", "The call is for early-career researchers and the profile fits.", excerpt))
            return

        senior_only = _SENIOR_ONLY.search(text)
        if senior_only:
            excerpt = _excerpt(text, senior_only)
            if not stage.strip():
                checks.append(ComplianceCheckResult("CAREER_STAGE_ELIGIBILITY", "NEEDS_MANUAL_REVIEW",
                    "The call is restricted to senior researchers; add your designation to check it.", excerpt))
                actions.append("Set your designation in Profile.")
                return
            senior = _is_senior(stage)
            checks.append(ComplianceCheckResult("CAREER_STAGE_ELIGIBILITY", "PASS" if senior else "FAIL",
                "The call is restricted to senior researchers." + ("" if senior else f" The profile says '{stage}'."), excerpt))

    def _check_limited_submission(self, text, checks, actions) -> bool:
        match = _LIMITED_SUBMISSION.search(text)
        if not match:
            return False
        checks.append(ComplianceCheckResult("LIMITED_SUBMISSION_QUOTA", "WARNING",
            "The institution can forward only a limited number of proposals; an internal selection is needed before the deadline.", _excerpt(text, match)))
        actions.append("Ask your Dean (R&D) / Office of Sponsored Research for the internal nomination deadline.")
        return True

    def _check_cost_sharing(self, text, checks, actions) -> None:
        match = _COST_SHARING.search(text)
        if match:
            checks.append(ComplianceCheckResult("COST_SHARING_REQUIREMENT", "WARNING",
                "The call requires an institutional financial contribution.", _excerpt(text, match)))
            actions.append("Get a commitment letter for the institutional contribution from your Head / Dean.")
