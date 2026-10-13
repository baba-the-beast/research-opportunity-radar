/**
 * Why a call was marked "Not relevant". Only a wrong topic should lower similar calls' scores:
 * "not eligible" or "too small" says nothing about the research area, so penalising its title
 * words would teach the scorer the wrong lesson.
 */
export const DISMISS_REASONS = [
  { value: 'wrong_topic', label: 'Not my research area', hint: 'Calls about the topics you pick below will rank lower.' },
  { value: 'not_eligible', label: "I'm not eligible", hint: 'Your matches stay the same. Check your eligibility details in your profile.' },
  { value: 'not_worth_it', label: 'Not worth applying', hint: 'Amount, effort or timing. Your matches stay the same.' },
  { value: 'already_covered', label: 'Already applied or funded elsewhere', hint: 'Your matches stay the same.' },
  { value: 'other', label: 'Something else', hint: 'Your matches stay the same.' }
] as const;

export type DismissReason = (typeof DISMISS_REASONS)[number]['value'];
export const DISMISS_REASON_VALUES = DISMISS_REASONS.map((r) => r.value) as [DismissReason, ...DismissReason[]];

/** Only this reason adds a scoring penalty. Old clients that send no reason keep the old behaviour. */
export const PENALISING_REASON: DismissReason = 'wrong_topic';

/** Prefix on feedback rows written by "Not relevant", so undo removes exactly those rows. */
export const DISMISSAL_MARKER = '[dismissed:';
export const LEGACY_DISMISSAL_TEXT = 'Dismissed by faculty';

const STOP_WORDS = new Set([
  'with', 'from', 'this', 'that', 'call', 'calls', 'proposals', 'proposal', 'special', 'issue', 'journal', 'research',
  'for', 'and', 'the', 'grant', 'grants', 'scheme', 'programme', 'program', 'funding', 'papers', 'conference', 'invited',
  'india', 'indian', 'national', 'international', 'year', 'phase', 'open'
]);

/** Distinctive title words to offer as "topics I don't work on" (same rule the API applies by default). */
export function suggestTopicTerms(title: string, max = 5): string[] {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter((w) => w.length > 3 && !/^\d+$/.test(w) && !STOP_WORDS.has(w));
  return Array.from(new Set(words)).slice(0, max);
}
