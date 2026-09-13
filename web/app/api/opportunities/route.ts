import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServerClient';

export async function GET() {
  try {
    const supabase = getSupabaseServerClient();
    const { data: opps, error } = await supabase
      .from('opportunities')
      .select(`
        id, kind, title, summary, agency_or_publisher, venue_name, doi, status, discovered_at, fingerprint,
        opportunity_deadlines (id, deadline_type, deadline_date, confidence, raw_text),
        opportunity_sources (source_url, source_id, sources (name)),
        opportunity_status (status),
        scoring_log (final_score, band, components, matched_terms)
      `)
      .order('discovered_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const formatted = (opps || []).map((row: any) => {
      const src = row.opportunity_sources?.[0];
      const scoring = row.scoring_log?.[0] || { final_score: 50, band: 'watch', matched_terms: [] };
      const dls = row.opportunity_deadlines || [];
      const nextDl = dls.length > 0 ? dls[0] : null;

      return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        summary: row.summary,
        agency_or_publisher: row.agency_or_publisher,
        venue_name: row.venue_name,
        primary_source_name: src?.sources?.name || row.agency_or_publisher || 'Primary Source',
        primary_source_url: src?.source_url || (row.doi ? `https://doi.org/${row.doi}` : ''),
        next_deadline: nextDl ? { deadline_date: nextDl.deadline_date, confidence: nextDl.confidence } : null,
        final_score: scoring.final_score,
        band: scoring.band,
        matched_terms: scoring.matched_terms || [],
        status: row.opportunity_status?.[0]?.status || 'new'
      };
    });

    return NextResponse.json(formatted);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
