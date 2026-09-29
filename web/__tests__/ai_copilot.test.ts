import { describe, it, expect, vi } from 'vitest';
import { runCopilotTurn } from '../lib/ai/llmProvider';

// Fake RLS-scoped client handed to the Copilot (tools never create their own client)
const fakeSupabase = (() => {
  const createQueryMock = (tableName: string) => {
    const mock: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(() => {
        if (tableName === 'opportunities') {
          return Promise.resolve({
            data: [
              {
                id: 'opp-1',
                kind: 'funding',
                title: 'NSF AI Institute on Cyber-Physical Systems',
                summary: 'Research call for robust machine intelligence in real-world systems.',
                agency_or_publisher: 'NSF',
                opportunity_deadlines: [{ deadline_date: '2026-11-15', confidence: 'confirmed' }],
                opportunity_sources: [{ source_url: 'https://nsf.gov/funding/opp-1' }]
              }
            ]
          });
        }
        if (tableName === 'scoring_log') {
          return Promise.resolve({
            data: [
              {
                final_score: 82.4,
                band: 'high',
                matched_terms: ['Autonomous Systems'],
                negative_matches: [],
                components: { topic_similarity: 71, method_match: -1, eligibility_report: { status: 'ELIGIBLE', summary: 'ok', action_items: [] } },
                scored_at: '2026-09-29T03:20:00Z'
              }
            ]
          });
        }
        return Promise.resolve({ data: [] });
      }),
      single: vi.fn().mockImplementation(() => {
        if (tableName === 'opportunities') {
          return Promise.resolve({
            data: {
              id: 'test-opp-123',
              title: 'NSF CAREER: Autonomous Systems',
              summary: 'Advancing resilient robotic systems and embedded AI algorithms.',
              agency_or_publisher: 'National Science Foundation'
            }
          });
        }
        return Promise.resolve({ data: null });
      }),
      maybeSingle: vi.fn().mockImplementation(() => {
        if (tableName === 'faculty_profile') {
          return Promise.resolve({
            data: {
              id: 'prof-1',
              full_name: 'Dr. Alan Turing',
              institution: 'Cambridge University',
              department: 'Computer Science',
              career_stage: 'mid_career',
              research_keywords: ['Autonomous Systems', 'Robotics', 'Artificial Intelligence']
            }
          });
        }
        return Promise.resolve({ data: null });
      }),
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'new-session' } })
        })
      }),
      upsert: vi.fn().mockResolvedValue({ error: null })
    };
    return mock;
  };

  return { from: (tableName: string) => createQueryMock(tableName) } as any;
})();

const ctx = { userId: 'usr-123', supabase: fakeSupabase };
const OPP_ID = '6f1c2b1e-9a4d-4c7e-8b2a-3d5e6f7a8b9c';

describe('AI Research Copilot Tests', () => {
  it('handles academic search requests and dispatches searchOpportunities tool', async () => {
    const result = await runCopilotTurn(
      [{ role: 'user', content: 'Find grant funding for Autonomous Systems and AI' }],
      ctx
    );

    expect(result.text).toContain('Academic Opportunities Discovered');
    expect(result.text).toContain('NSF AI Institute');
    expect(result.executedTools.length).toBeGreaterThan(0);
    expect(result.executedTools[0].name).toBe('searchOpportunities');
  });

  it('handles profile queries and returns investigator node parameters', async () => {
    const result = await runCopilotTurn(
      [{ role: 'user', content: 'Show my active research profile keywords' }],
      ctx
    );

    expect(result.text).toContain('Investigator Node Configuration');
    expect(result.text).toContain('Dr. Alan Turing');
    expect(result.executedTools.some((t) => t.name === 'getUserProfile')).toBe(true);
  });

  it('handles recommendation rationale queries', async () => {
    const result = await runCopilotTurn(
      [{ role: 'user', content: `Why is opportunity ${OPP_ID} recommended for me?` }],
      ctx
    );

    expect(result.text).toContain('Recommendation Rationale Analysis');
    expect(result.text).toContain('Thematic Fit');
    expect(result.executedTools.some((t) => t.name === 'getWhyRecommended')).toBe(true);
    // The rationale comes from the pipeline's real score, with not-applicable components left out
    const why = result.executedTools.find((t) => t.name === 'getWhyRecommended')!.result;
    expect(why.final_score).toBe(82);
    expect(why.matched_keywords).toEqual(['Autonomous Systems']);
    expect(why.components).toEqual({ topic_similarity: 71 });
  });
});

describe('Copilot tool guards', () => {
  it('strips PostgREST filter syntax from LLM-supplied search terms', async () => {
    const { sanitizeSearchTerm } = await import('../lib/ai/tools');
    expect(sanitizeSearchTerm('ai,id.eq.1),or(title.ilike.*')).toBe('ai id eq 1 or title ilike');
    expect(sanitizeSearchTerm('50% "quoted" \ back_slash')).toBe('50 quoted back slash');
  });

  it('rejects non-UUID opportunity ids before touching the database', async () => {
    const { executeTool } = await import('../lib/ai/tools');
    const result = await executeTool('saveOpportunity', { opportunityId: 'x,user_id.eq.other', saved: 'true' }, ctx);
    expect(result.error).toMatch(/UUID/);
  });
});
