import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServerClient';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params?.id?.trim();
    if (!id || !/^[a-zA-Z0-9_\-\.]{1,64}$/.test(id)) {
      return NextResponse.json({ error: 'Invalid opportunity identifier format' }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const { data: row, error } = await supabase
      .from('opportunities')
      .select(`
        *,
        opportunity_deadlines (*),
        opportunity_sources (*, sources(name)),
        opportunity_status (*),
        scoring_log (*)
      `)
      .eq('id', id)
      .single();

    if (error || !row) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 });
    }

    const scoring = row.scoring_log?.[0] || {
      final_score: 50,
      band: 'watch',
      components: { topic_similarity: 50, exact_term_match: 50 },
      matched_terms: [],
      negative_matches: []
    };

    return NextResponse.json({
      id: row.id,
      kind: row.kind,
      title: row.title,
      summary: row.summary,
      agency_or_publisher: row.agency_or_publisher,
      venue_name: row.venue_name,
      doi: row.doi,
      status: row.opportunity_status?.[0]?.status || 'new',
      discovered_at: row.discovered_at,
      deadlines: row.opportunity_deadlines || [],
      sources: (row.opportunity_sources || []).map((s: any) => ({
        source_name: s.sources?.name || 'Unknown',
        source_url: s.source_url,
        first_seen_at: s.first_seen_at,
        last_seen_at: s.last_seen_at
      })),
      score_explanation: {
        model_version: scoring.model_version || 'component-v1',
        final_score: scoring.final_score,
        band: scoring.band,
        components: scoring.components || {},
        matched_terms: scoring.matched_terms || [],
        negative_matches: scoring.negative_matches || [],
        eligibility: { status: scoring.band !== 'not_eligible' ? 'eligible' : 'ineligible', confidence: 0.8 }
      },
      eligibility_report: row.metadata?.eligibility_report || null,
      metadata: row.metadata || {}
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
