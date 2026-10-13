import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISMISSAL_MARKER, DISMISS_REASONS, DISMISS_REASON_VALUES, PENALISING_REASON, suggestTopicTerms } from '../lib/feedback';

describe('"Not relevant" reasons', () => {
  it('only the wrong-topic reason penalises, and it is the default for old clients', () => {
    expect(PENALISING_REASON).toBe('wrong_topic');
    expect(DISMISS_REASON_VALUES).toContain(PENALISING_REASON);
    expect(DISMISS_REASONS.every((r) => r.label.length > 0 && r.hint.length > 0)).toBe(true);
  });

  it('suggests distinctive title words, not filler', () => {
    expect(suggestTopicTerms('Call for Proposals: Marine Biology and Coral Reef Restoration 2026')).toEqual(['marine', 'biology', 'coral', 'reef', 'restoration']);
    expect(suggestTopicTerms('Special Issue on Quantum Computing')).toEqual(['quantum', 'computing']);
  });

  it('drops numbers and duplicates and caps the list', () => {
    expect(suggestTopicTerms('2026 2027 ocean ocean ocean')).toEqual(['ocean']);
    expect(suggestTopicTerms('alpha bravo charlie delta echo foxtrot golf', 3)).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('keeps hyphenated terms whole', () => {
    expect(suggestTopicTerms('Low-power edge-AI hardware')).toEqual(['low-power', 'edge-ai', 'hardware']);
  });

  it('marks stored feedback so undo deletes exactly those rows', () => {
    const route = readFileSync(join(__dirname, '..', 'app', 'api', 'opportunities', '[id]', 'status', 'route.ts'), 'utf-8');
    expect(DISMISSAL_MARKER).toBe('[dismissed:');
    expect(route).toContain('`${DISMISSAL_MARKER}${reason}]');
    // The undo filter quotes its values: ':' and spaces are reserved inside PostgREST or()
    expect(route).toContain('feedback_text.like."${DISMISSAL_MARKER}*"');
  });
});
