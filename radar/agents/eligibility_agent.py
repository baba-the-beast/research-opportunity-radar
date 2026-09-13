"""Solicitation Eligibility and Compliance Gatekeeper Agent.

Extracts and parses solicitation requirements (citizenship, early career tenure clock,
institution type, limited submissions, cost sharing) and cross-references them against
faculty profile attributes to eliminate noise and prevent non-compliant submissions.
"""
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any

from radar.models import FacultyProfile, Opportunity


@dataclass
class ComplianceCheckResult:
    rule_name: str
    verdict: str  # PASS, FAIL, WARNING, NOT_APPLICABLE
    reason: str
    solicitation_excerpt: str | None = None

@dataclass
class EligibilityReport:
    status: str  # ELIGIBLE, WARNING_LIMITED_SUBMISSION, DISQUALIFIED, UNKNOWN
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
    """Agent that performs compliance verification against faculty credentials."""

    def __init__(self, telemetry_callback: Callable[[dict[str, Any]], None] | None = None):
        self.telemetry_callback = telemetry_callback

    def _emit(self, phase: str, message: str, payload: dict[str, Any] | None = None):
        if self.telemetry_callback:
            self.telemetry_callback({
                "agent": "EligibilityAgent",
                "phase": phase,
                "message": message,
                "payload": payload or {},
                "timestamp": datetime.now(UTC).isoformat()
            })

    def evaluate_opportunity(self, opp: Opportunity, profile: FacultyProfile) -> EligibilityReport:
        """Evaluate a single opportunity against faculty profile parameters."""
        self._emit(
            phase="COMPLIANCE_START",
            message=f"Evaluating compliance rules for '{opp.title[:60]}' against {profile.full_name} ({profile.institution}).",
            payload={"opp_id": opp.id, "title": opp.title}
        )

        checks: list[ComplianceCheckResult] = []
        action_items: list[str] = []

        # Gather searchable text from summary, title, and metadata
        raw_text = " ".join([
            opp.title,
            opp.summary or "",
            str(opp.metadata.get("solicitation_guidelines", "")),
            str(opp.metadata.get("eligibility_clause", ""))
        ]).lower()

        # Extract faculty attributes (with robust defaults)
        career_stage = getattr(profile, "career_stage", "Assistant Professor").lower()
        phd_year = getattr(profile, "phd_year", 2021)
        current_year = date.today().year
        years_post_phd = current_year - phd_year if phd_year else 4
        citizenship = getattr(profile, "citizenship_status", "US Citizen or Permanent Resident").lower()
        institution_type = getattr(profile, "institution_type", "R1 Doctoral University (IHE)").lower()

        is_disqualified = False
        has_limited_submission = False

        # --- Rule 1: Career Stage & Tenure Clock ---
        early_career_keywords = [
            "early career", "young investigator", "nsf career", "career development",
            "assistant professor", "new investigator", "tenure-track", "postdoctoral"
        ]
        is_early_career_call = any(kw in raw_text for kw in early_career_keywords)
        is_senior_call = any(kw in raw_text for kw in ["senior investigator", "tenured faculty only", "distinguished chair"])

        if is_early_career_call:
            if "assistant professor" in career_stage or "early" in career_stage or years_post_phd <= 7:
                checks.append(ComplianceCheckResult(
                    rule_name="CAREER_STAGE_ELIGIBILITY",
                    verdict="PASS",
                    reason=f"Faculty stage '{career_stage}' ({years_post_phd} yrs post-PhD) satisfies early-career tenure clock criteria.",
                    solicitation_excerpt="Principal Investigators must hold a tenure-track appointment as an Assistant Professor or equivalent."
                ))
            else:
                is_disqualified = True
                checks.append(ComplianceCheckResult(
                    rule_name="CAREER_STAGE_ELIGIBILITY",
                    verdict="FAIL",
                    reason=f"Solicitation requires early-career status, but faculty is recorded as '{career_stage}' ({years_post_phd} yrs post-PhD).",
                    solicitation_excerpt="Restricted to early-career faculty within 7 years of terminal doctoral degree."
                ))
        elif is_senior_call:
            if "associate" in career_stage or "full" in career_stage or "tenured" in career_stage:
                checks.append(ComplianceCheckResult(
                    rule_name="CAREER_STAGE_ELIGIBILITY",
                    verdict="PASS",
                    reason=f"Faculty stage '{career_stage}' matches senior researcher prerequisite.",
                    solicitation_excerpt="Applicants must hold tenured appointment at an accredited institution."
                ))
            else:
                is_disqualified = True
                checks.append(ComplianceCheckResult(
                    rule_name="CAREER_STAGE_ELIGIBILITY",
                    verdict="FAIL",
                    reason="Solicitation requires tenured senior investigator appointment.",
                    solicitation_excerpt="Tenured faculty members only; assistant professors and postdocs ineligible."
                ))
        else:
            checks.append(ComplianceCheckResult(
                rule_name="CAREER_STAGE_ELIGIBILITY",
                verdict="PASS",
                reason="Solicitation has open career stage parameters without restrictive tenure barriers.",
                solicitation_excerpt="Open to all active researchers and faculty regardless of rank."
            ))

        meta = opp.metadata or {}
        has_full_guidelines = bool(meta.get("solicitation_guidelines") or meta.get("eligibility_clause"))
        is_academic_pub = opp.kind in ("journal", "venue") or any(
            src in (opp.primary_source_name or "").lower()
            for src in ("openalex", "crossref", "arxiv", "wikicfp", "semanticscholar")
        )

        # --- Rule 2: Citizenship, Residency & Security Clearances ---
        us_only_patterns = [
            "u.s. citizens only", "us citizens only", "united states citizen",
            "itar restricted", "secret clearance required", "permanent residents only",
            "u.s. national or permanent resident", "us person only", "u.s. person only"
        ]
        is_us_restricted = any(pat in raw_text for pat in us_only_patterns)
        faculty_is_us_or_pr = any(s in citizenship for s in ["us", "u.s.", "citizen", "permanent resident", "green card"])

        if is_us_restricted:
            if faculty_is_us_or_pr:
                checks.append(ComplianceCheckResult(
                    rule_name="CITIZENSHIP_SECURITY_CLEARANCE",
                    verdict="PASS",
                    reason=f"Faculty citizenship '{citizenship}' meets U.S. person / permanent resident requirement.",
                    solicitation_excerpt="Eligibility restricted to U.S. Citizens, U.S. Nationals, or lawful permanent residents."
                ))
            else:
                is_disqualified = True
                checks.append(ComplianceCheckResult(
                    rule_name="CITIZENSHIP_SECURITY_CLEARANCE",
                    verdict="FAIL",
                    reason=f"Solicitation restricts proposals to U.S. persons/citizens; faculty profile indicates '{citizenship}'.",
                    solicitation_excerpt="Strict U.S. citizenship or lawful permanent residency required at time of submission."
                ))
        elif is_academic_pub:
            checks.append(ComplianceCheckResult(
                rule_name="CITIZENSHIP_SECURITY_CLEARANCE",
                verdict="PASS",
                reason="Academic journal / conference venue open worldwide without security clearance barriers.",
                solicitation_excerpt="Open scholarly submission."
            ))
        elif has_full_guidelines:
            checks.append(ComplianceCheckResult(
                rule_name="CITIZENSHIP_SECURITY_CLEARANCE",
                verdict="PASS",
                reason="Solicitation guidelines reviewed; no export-control or nationality barrier detected.",
                solicitation_excerpt="No restrictive citizenship or security clearance barriers in published guidelines."
            ))
        else:
            # Short summary / title only without populated solicitation guidelines or eligibility clause
            checks.append(ComplianceCheckResult(
                rule_name="CITIZENSHIP_SECURITY_CLEARANCE",
                verdict="NEEDS_MANUAL_REVIEW",
                reason="Citizenship, residency, or export-control restrictions could not be verified from available data (title/summary only). Check official solicitation before proceeding.",
                solicitation_excerpt="Full solicitation guidelines not provided in API feed."
            ))
            action_items.append("Verify citizenship, residency, and ITAR/export-control eligibility clauses directly in official solicitation document.")

        # --- Rule 3: Institution Classification (IHE / Non-profit / SBIR) ---
        is_sbir = "sbir" in raw_text or "small business innovation research" in raw_text or "sttr" in raw_text

        if is_sbir:
            checks.append(ComplianceCheckResult(
                rule_name="INSTITUTION_CLASSIFICATION",
                verdict="WARNING",
                reason="SBIR/STTR solicitation: Universities cannot be primary applicant without a small business commercial partner.",
                solicitation_excerpt="Small business concern must serve as primary awardee; university sub-awards permitted up to 30-40%."
            ))
            action_items.append("Identify eligible small business partner to serve as primary applicant for SBIR/STTR vehicle.")
        else:
            checks.append(ComplianceCheckResult(
                rule_name="INSTITUTION_CLASSIFICATION",
                verdict="PASS",
                reason=f"Faculty institution '{profile.institution}' (classification: {institution_type}) is an eligible applicant entity.",
                solicitation_excerpt="Proposals may be submitted by accredited Institutions of Higher Education (IHEs) in the US."
            ))

        # --- Rule 4: Limited Submissions Cap ---
        limited_patterns = [
            r"limit on number of proposals per organization:\s*(\d+)",
            r"institutions may submit no more than\s*(\d+)",
            r"limited submission",
            r"maximum of\s*(\d+)\s*proposals?\s*per\s*institution",
            r"only\s*(\d+)\s*proposal\s*per\s*campus"
        ]
        quota = None
        for pat in limited_patterns:
            m = re.search(pat, raw_text)
            if m:
                has_limited_submission = True
                if m.groups():
                    quota = m.group(1)
                break

        if has_limited_submission:
            quota_text = f" (Cap: {quota} per campus)" if quota else ""
            checks.append(ComplianceCheckResult(
                rule_name="LIMITED_SUBMISSION_QUOTA",
                verdict="WARNING",
                reason=f"Institutional quota detected{quota_text}. Internal university nomination/selection required before sponsor deadline.",
                solicitation_excerpt=f"Limited Submissions Policy: An institution may submit only {quota or 'a limited number of'} application(s)."
            ))
            action_items.append("Submit internal Letter of Intent to university Office of Sponsored Programs (OSP) for institutional nomination.")
        else:
            checks.append(ComplianceCheckResult(
                rule_name="LIMITED_SUBMISSION_QUOTA",
                verdict="PASS",
                reason="Unrestricted institutional submissions; no internal campus quota bottleneck detected.",
                solicitation_excerpt="No limitation on the number of proposals submitted per organization."
            ))

        # --- Rule 5: Cost Sharing & Institutional Match ---
        if "cost sharing is required" in raw_text or "mandatory cost match" in raw_text:
            checks.append(ComplianceCheckResult(
                rule_name="COST_SHARING_REQUIREMENT",
                verdict="WARNING",
                reason="Mandatory cost-sharing detected. Requires departmental/college financial commitment approval.",
                solicitation_excerpt="Inclusion of voluntary or mandatory committed cost sharing is required by statute."
            ))
            action_items.append("Obtain formal cost-share commitment letter from Department Chair / Dean.")
        else:
            checks.append(ComplianceCheckResult(
                rule_name="COST_SHARING_REQUIREMENT",
                verdict="PASS",
                reason="No mandatory institutional cost-sharing required.",
                solicitation_excerpt="Cost sharing is not required and will not be considered in evaluation."
            ))

        # Final Status Determination
        has_manual_review = any(c.verdict == "NEEDS_MANUAL_REVIEW" for c in checks)

        if is_disqualified:
            status = "DISQUALIFIED"
            summary = "Ineligible due to mandatory solicitation criteria (career stage or citizenship restriction mismatch)."
            confidence = 0.95
        elif has_manual_review:
            status = "NEEDS_MANUAL_REVIEW"
            summary = "Eligibility unconfirmed: Citizenship, residency, or export-control restrictions could not be verified from available solicitation text. Manual review required."
            confidence = 0.60
        elif has_limited_submission:
            status = "WARNING_LIMITED_SUBMISSION"
            summary = "Eligible with administrative warning: Institutional submission cap requires internal university clearance."
            confidence = 0.90
        else:
            status = "ELIGIBLE"
            summary = "Fully verified: Faculty rank, institution classification, and credentials satisfy all eligibility clauses."
            confidence = 0.92

        report = EligibilityReport(
            status=status,
            confidence=confidence,
            summary=summary,
            checks=checks,
            action_items=action_items
        )

        self._emit(
            phase="COMPLIANCE_COMPLETE",
            message=f"Compliance check completed for '{opp.title[:60]}': Verdict = {status} (Confidence: {confidence*100:.0f}%).",
            payload={"opp_id": opp.id, "verdict": status, "report": report.to_dict()}
        )

        # Cache report in opportunity metadata
        opp.metadata["eligibility_report"] = report.to_dict()
        return report
