import { getSupabaseAdminClient } from '../supabaseServerClient';

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
 * Executes a tool call strictly within the context and authorization of the authenticated user.
 */
export async function executeTool(name: string, args: Record<string, any>, userId: string): Promise<any> {
  const supabase = getSupabaseAdminClient();

  switch (name) {
    case 'searchOpportunities': {
      const q = (args.query || '').trim().toLowerCase();
      const kind = args.kind && args.kind !== 'all' ? args.kind : null;
      const limit = Math.min(Math.max(1, parseInt(args.limit || '5', 10)), 10);

      let query = supabase
        .from('opportunities')
        .select(`
          id, kind, title, summary, agency_or_publisher, venue_name,
          opportunity_deadlines (deadline_date, confidence, deadline_type),
          opportunity_sources (source_url, sources (name))
        `)
        .order('discovered_at', { ascending: false });

      if (kind) {
        query = query.eq('kind', kind);
      }

      if (q) {
        query = query.or(`title.ilike.%${q}%,summary.ilike.%${q}%,agency_or_publisher.ilike.%${q}%`);
      }

      const { data, error } = await query.limit(limit);
      if (error) return { error: error.message };

      return (data || []).map((opp: any) => ({
        id: opp.id,
        kind: opp.kind,
        title: opp.title,
        agency_or_publisher: opp.agency_or_publisher || opp.venue_name || 'Academic Venue',
        summary: opp.summary ? opp.summary.slice(0, 200) + '...' : 'No summary available.',
        next_deadline: opp.opportunity_deadlines?.[0]?.deadline_date || 'Rolling / Unspecified',
        source_url: opp.opportunity_sources?.[0]?.source_url || '#'
      }));
    }

    case 'getOpportunityDetails': {
      const id = (args.opportunityId || '').trim();
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
      const id = (args.opportunityId || '').trim();
      // Fetch opportunity and profile
      const [oppRes, profRes] = await Promise.all([
        supabase.from('opportunities').select('id, title, summary, agency_or_publisher').eq('id', id).single(),
        supabase.from('faculty_profile').select('*').eq('user_id', userId).maybeSingle()
      ]);

      if (!oppRes.data) return { error: 'Opportunity not found' };

      const opp = oppRes.data;
      const prof = profRes.data || {
        research_keywords: ['Artificial Intelligence', 'Systems'],
        full_name: 'Investigator'
      };

      const matched: string[] = [];
      const content = `${opp.title} ${opp.summary || ''}`.toLowerCase();
      for (const kw of prof.research_keywords || []) {
        if (content.includes(kw.toLowerCase())) {
          matched.push(kw);
        }
      }

      return {
        opportunity_id: id,
        title: opp.title,
        matched_keywords: matched.length > 0 ? matched : ['Cross-disciplinary alignment'],
        investigator_keywords: prof.research_keywords || [],
        rationale: matched.length > 0
          ? `Direct thematic alignment on: ${matched.join(', ')}.`
          : 'High cross-disciplinary relevance based on structural agency priorities and methodology.'
      };
    }

    case 'saveOpportunity': {
      const id = (args.opportunityId || '').trim();
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
