import { describe, expect, it } from 'vitest';
import { eligibilityLabel, eligibilityLine, ruleLabel } from '../lib/eligibility';

describe('eligibility verdict wording', () => {
  it('stays quiet on feed cards for eligible calls', () => {
    expect(eligibilityLine({ status: 'ELIGIBLE', summary: 'No eligibility barrier found in the call text. Confirm with the official call document.' })).toBeNull();
  });

  it('shows what to check, without the boilerplate tail', () => {
    expect(eligibilityLine({ status: 'NEEDS_MANUAL_REVIEW', summary: 'Check before applying: only for SC/ST researchers.' })).toBe(
      'Check before applying: only for SC/ST researchers.'
    );
  });

  it('marks a disqualified call as danger', () => {
    expect(eligibilityLabel({ status: 'DISQUALIFIED', summary: 'Not eligible: the call’s age limit requirement is not met.' }).tone).toBe('danger');
    expect(eligibilityLabel(null).text).toBe('Not checked yet');
  });
});

describe('ruleLabel', () => {
  it('names checks in plain words and falls back to the rule name', () => {
    expect(ruleLabel('CITIZENSHIP_SECURITY_CLEARANCE')).toBe('Nationality');
    expect(ruleLabel('APPLICANT_TYPE')).toBe('Who can apply');
    expect(ruleLabel('SOME_NEW_RULE')).toBe('Some new rule');
  });
});
