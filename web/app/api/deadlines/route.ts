import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServerClient';

export async function GET() {
  try {
    const supabase = getSupabaseServerClient();
    const { data: dls, error } = await supabase
      .from('opportunity_deadlines')
      .select('*, opportunities(id, title, kind, opportunity_sources(source_url))')
      .order('deadline_date', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const formatted = (dls || []).map((row: any) => ({
      id: row.id,
      opportunity_id: row.opportunities?.id,
      title: row.opportunities?.title || 'Untitled',
      deadline_type: row.deadline_type,
      deadline_date: row.deadline_date,
      confidence: row.confidence,
      source_url: row.opportunities?.opportunity_sources?.[0]?.source_url || '#'
    }));

    return NextResponse.json(formatted);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
