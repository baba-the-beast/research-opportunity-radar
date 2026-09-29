import { istDate } from '@/lib/dates';
import type { SupabaseClient } from '@supabase/supabase-js';
import { UUID_PATTERN } from '../routeContext';

export interface ToolContext {
  userId: string;
  /** The caller's RLS-scoped client (see getRequestSupabase). Tools never use the service role. */
  supabase: SupabaseClient;
}

/**
 * Tool arguments come from the LLM, which is steered by user text and by scraped opportunity
 * content. Strip PostgREST filter syntax (, . ( ) " \) and LIKE wildcards before building .or().
 */
export function sanitizeSearchTerm(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[,.()"'\\%*_:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 100);
}

function requireOpportunityId(raw: unknown): string | null {
  const id = String(raw ?? '').trim();
  return UUID_PATTERN.test(id) ? id : null;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
}

export const COPILOT_TOOLS: ToolDefinition[] = [
  {
    name: 'searchOpportunities',
    description: 'Search academic funding calls, journal special issues, and conference venues matching keywords, research topics, or agency names.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms, field of research, or keywords (e.g., "Edge AI", "Quantum Computing", "NSF")' },
        kind: { type: 'string', description: 'Opportunity kind filter', enum: ['all', 'funding', 'journal', 'venue'] },
        limit: { type: 'string', description: 'Maximum number of opportunities to retrieve (default 5)' }
      },
      required: ['query']
    }
  },
  {
    name: 'getOpportunityDetails',
    description: 'Retrieve full specifications, deadline milestones, and verified source citations for a specific opportunity ID.',
    parameters: {
      type: 'object',
      properties: {
        opportunityId: { type: 'string', description: 'The UUID identifier of the opportunity' }
      },
      required: ['opportunityId']
    }
  },
  {
    name: 'getWhyRecommended',
    description: 'Analyze and explain why a particular opportunity is recommended for the current investigator based on profile keywords, topics, and criteria.',
    parameters: {
      type: 'object',
      properties: {
        opportunityId: { type: 'string', description: 'The UUID identifier of the opportunity to analyze' }
      },
      required: ['opportunityId']
    }
  },
  {
    name: 'saveOpportunity',
    description: 'Bookmark or unbookmark an opportunity for the active investigator so it appears in their saved radar.',
    parameters: {
      type: 'object',
      properties: {
        opportunityId: { type: 'string', description: 'The UUID identifier of the opportunity' },
        saved: { type: 'string', description: 'Whether to bookmark ("true") or remove ("false")', enum: ['true', 'false'] }
      },
      required: ['opportunityId', 'saved']
    }
  },
  {
    name: 'getUserProfile',
    description: 'Retrieve the active investigator profile, calibration keywords, institution, and career stage.',
    parameters: {
      type: 'object',
      properties: {}
    }
  }
];

/**
 * Executes a tool call with the caller's own RLS-scoped client, so the LLM can never reach
 * rows the user could not read or write directly.
 */
export async function executeTool(name: string, args: Record<string, any>, ctx: ToolContext): Promise<any> {
  const { supabase, userId } = ctx;

  switch (name) {
    case 'searchOpportunities': {
      const q = sanitizeSearchTerm(args.query);
      const kind = ['funding', 'journal', 'venue'].includes(args.kind) ? args.kind : null;
      const limit = Math.min(Math.max(1, parseInt(args.limit || '5', 10) || 5), 10);

      let query = supabase
        .from('opportunities')
        .select(`
          id, kind, title, summary, agency_or_publisher, venue_name,
          opportunity_deadlines (deadline_date, confidence, deadline_type),
          opportunity_sources (source_url, sources (name))
        `)
        // Closed calls (every deadline passed) can't be applied to
        .neq('status', 'closed')
        .order('discovered_at', { ascending: false });

      if (kind) {
        query = query.eq('kind', kind);
      }

      if (q) {
        query = query.or(`title.ilike.%${q}%,summary.ilike.%${q}%,agency_or_publisher.ilike.%${q}%`);
      }

      const { data, error } = await query.limit(limit);
      if (error) return { error: error.message };

      const today = istDate();
      return (data || []).map((opp: any) => {
        const next = (opp.opportunity_deadlines || [])
          .filter((d: any) => d.deadline_date && d.deadline_date >= today)
          .sort((a: any, b: any) => a.deadline_date.localeCompare(b.deadline_date))[0];
        return {
          id: opp.id,
          kind: opp.kind,
          title: opp.title,
          agency_or_publisher: opp.agency_or_publisher || opp.venue_name || null,
          summary: opp.summary ? opp.summary.slice(0, 200) + '...' : 'No summary available.',
          next_deadline: next ? `${next.deadline_date} (India time)` : 'Not published',
          source_url: opp.opportunity_sources?.[0]?.source_url || null
        };
      });
    }

    case 'getOpportunityDetails': {
      const id = requireOpportunityId(args.opportunityId);
      if (!id) return { error: 'opportunityId must be an opportunity UUID' };
      const { data, error } = await supabase
        .from('opportunities')
        .select(`
          id, kind, title, summary, agency_or_publisher, venue_name, doi, discovered_at,
          opportunity_deadlines (id, deadline_type, deadline_date, confidence, raw_text),
          opportunity_sources (source_url, external_id, sources (name))
        `)
        .eq('id', id)
        .single();

      if (error || !data) return { error: 'Opportunity not found' };
      return data;
    }

    case 'getWhyRecommended': {
      const id = requireOpportunityId(args.opportunityId);
      if (!id) return { error: 'opportunityId must be an opportunity UUID' };
      const [oppRes, profRes] = await Promise.all([
        supabase.from('opportunities').select('id, title').eq('id', id).single(),
        supabase.from('faculty_profile').select('id, research_keywords').eq('user_id', userId).maybeSingle()
      ]);
      if (!oppRes.data) return { error: 'Opportunity not found' };
      if (!profRes.data) return { error: 'No profile yet: set up your profile so calls can be scored for you.' };

      // The explanation is the pipeline's own latest score for this user, not a re-guess
      const { data: scores } = await supabase
        .from('scoring_log')
        .select('final_score, band, components, matched_terms, negative_matches, scored_at')
        .eq('faculty_id', profRes.data.id)
        .eq('opportunity_id', id)
        .order('scored_at', { ascending: false })
        .limit(1);
      const score = scores?.[0];
      if (!score) {
        return { opportunity_id: id, title: oppRes.data.title, error: 'Not scored for you yet; it will be after the next scan.' };
      }
      const { eligibility_report: eligibility, ...components } = score.components || {};
      const used = Object.fromEntries(
        Object.entries(components).filter(([, v]) => typeof v === 'number' && v >= 0).map(([k, v]) => [k, Math.round(v as number)])
      );
      return {
        opportunity_id: id,
        title: oppRes.data.title,
        final_score: Math.round(Number(score.final_score)),
        band: score.band,
        matched_keywords: score.matched_terms || [],
        penalised_terms: score.negative_matches || [],
        components: used,
        eligibility: eligibility ? { status: eligibility.status, summary: eligibility.summary, action_items: eligibility.action_items } : null,
        investigator_keywords: profRes.data.research_keywords || [],
        rationale: (score.matched_terms || []).length
          ? `Matched your terms: ${score.matched_terms.join(', ')}.`
          : 'No exact term matched; the score comes from the similarity between the call text and your research summary.'
      };
    }

    case 'saveOpportunity': {
      const id = requireOpportunityId(args.opportunityId);
      if (!id) return { error: 'opportunityId must be an opportunity UUID' };
      const saved = args.saved === 'true' || args.saved === true;

      const { error } = await supabase
        .from('user_opportunity_state')
        .upsert({
          user_id: userId,
          opportunity_id: id,
          saved,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id,opportunity_id' });

      if (error) return { error: error.message };

      return {
        success: true,
        opportunity_id: id,
        saved,
        message: saved ? 'Opportunity successfully saved to radar.' : 'Opportunity removed from saved radar.'
      };
    }

    case 'getUserProfile': {
      const { data, error } = await supabase
        .from('faculty_profile')
        .select('id, full_name, institution, department, career_stage, research_keywords, profile_text')
        .eq('user_id', userId)
        .maybeSingle();

      if (error || !data) {
        return {
          full_name: 'Active Investigator',
          status: 'Profile calibration pending'
        };
      }

      return data;
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
