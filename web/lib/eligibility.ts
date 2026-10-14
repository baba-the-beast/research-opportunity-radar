import type { Tone } from '@/components/ui';

/** The eligibility verdict the pipeline stores per call and user (radar/agents/eligibility_agent.py). */
export interface EligibilityVerdict {
  status: string; // ELIGIBLE, WARNING_LIMITED_SUBMISSION, NEEDS_MANUAL_REVIEW, DISQUALIFIED
  summary: string;
}

/** Short label and tone for a verdict, shared by the feed and the call page. */
export function eligibilityLabel(verdict?: EligibilityVerdict | null): { tone: Tone; text: string; icon: string } {
  if (!verdict) return { tone: 'neutral', text: 'Not checked yet', icon: 'help' };
  if (verdict.status === 'ELIGIBLE') return { tone: 'success', text: 'You appear eligible', icon: 'check_circle' };
  if (verdict.status === 'NEEDS_MANUAL_REVIEW') return { tone: 'warning', text: 'Check eligibility', icon: 'fact_check' };
  if (verdict.status.includes('WARNING')) return { tone: 'warning', text: 'Limited submission', icon: 'group' };
  return { tone: 'danger', text: 'You may not be eligible', icon: 'block' };
}

/** The verdict as one plain sentence for a feed card: the summary without its boilerplate tail. */
export function eligibilityLine(verdict?: EligibilityVerdict | null): string | null {
  if (!verdict?.summary) return null;
  if (verdict.status === 'ELIGIBLE') return null; // the common case; the card stays quiet
  return verdict.summary.replace(/\s*Confirm with the official call document\.?$/, '');
}

/** Plain names for the checks in radar/agents/eligibility_agent.py; unknown ones fall back to the rule name. */
const RULE_LABELS: Record<string, string> = {
  CITIZENSHIP_SECURITY_CLEARANCE: 'Nationality',
  AGE_LIMIT: 'Age limit',
  SERVICE_BEFORE_SUPERANNUATION: 'Years of service left before retirement',
  REGULAR_POSITION: 'Regular post',
  REGION: 'North-East only',
  CAREER_STAGE_ELIGIBILITY: 'Career stage',
  WOMEN_ONLY: 'Only for women researchers',
  RESERVED_CATEGORY: 'Only for SC/ST researchers',
  INSTITUTION_TYPE: 'Institution type',
  PHD_REQUIRED: 'PhD required',
  APPLICANT_TYPE: 'Who can apply',
  ONGOING_PROJECT: 'No ongoing project under this scheme',
  LIMITED_SUBMISSION_QUOTA: 'Limited proposals per institution',
  COST_SHARING_REQUIREMENT: 'Institutional contribution'
};

export function ruleLabel(rule: string): string {
  const t = rule.replace(/_/g, ' ').trim().toLowerCase();
  return RULE_LABELS[rule] ?? t.charAt(0).toUpperCase() + t.slice(1);
}

/** What a user can say about one eligibility check (eligibility_corrections.correction). */
export const CORRECTIONS = [
  { value: 'i_meet_it', label: 'I do meet this' },
  { value: 'i_do_not_meet_it', label: 'I don’t meet this' },
  { value: 'rule_does_not_apply', label: 'The call doesn’t say this' }
] as const;
