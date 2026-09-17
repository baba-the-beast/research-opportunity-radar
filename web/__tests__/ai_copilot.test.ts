import { describe, it, expect, vi } from 'vitest';
import { runCopilotTurn } from '../lib/ai/llmProvider';

// Mock Supabase Server client for offline tests
vi.mock('../lib/supabaseServerClient', () => {
  const createQueryMock = (tableName: string) => {
    const mock: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
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

  return {
    getSupabaseAdminClient: () => ({
      from: (tableName: string) => createQueryMock(tableName)
    })
  };
});

describe('AI Research Copilot Tests', () => {
  it('handles academic search requests and dispatches searchOpportunities tool', async () => {
    const result = await runCopilotTurn(
      [{ role: 'user', content: 'Find grant funding for Autonomous Systems and AI' }],
      'usr-123'
    );

    expect(result.text).toContain('Academic Opportunities Discovered');
    expect(result.text).toContain('NSF AI Institute');
    expect(result.executedTools.length).toBeGreaterThan(0);
    expect(result.executedTools[0].name).toBe('searchOpportunities');
  });

  it('handles profile queries and returns investigator node parameters', async () => {
    const result = await runCopilotTurn(
      [{ role: 'user', content: 'Show my active research profile keywords' }],
      'usr-123'
    );

    expect(result.text).toContain('Investigator Node Configuration');
    expect(result.text).toContain('Dr. Alan Turing');
    expect(result.executedTools.some((t) => t.name === 'getUserProfile')).toBe(true);
  });

  it('handles recommendation rationale queries', async () => {
    const result = await runCopilotTurn(
      [{ role: 'user', content: 'Why is opportunity test-opp-123 recommended for me?' }],
      'usr-123'
    );

    expect(result.text).toContain('Recommendation Rationale Analysis');
    expect(result.text).toContain('Thematic Fit');
    expect(result.executedTools.some((t) => t.name === 'getWhyRecommended')).toBe(true);
  });
});
