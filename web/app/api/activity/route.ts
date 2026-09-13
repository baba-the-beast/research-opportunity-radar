import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServerClient';

export async function GET() {
  try {
    const supabase = getSupabaseServerClient();
    const { data: runs, error } = await supabase
      .from('run_log')
      .select('*, source_runs(*, sources(name))')
      .order('started_at', { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const formatted = (runs || []).map((r: any) => ({
      run_id: r.id,
      started_at: r.started_at,
      finished_at: r.finished_at,
      status: r.status,
      opportunities_found: r.opportunities_found,
      opportunities_new: r.opportunities_new,
      errors: r.errors || [],
      sources: (r.source_runs || []).map((sr: any) => ({
        source_name: sr.sources?.name || 'Unknown Source',
        status: sr.status,
        request_count: sr.request_count,
        inserted_count: sr.inserted_count,
        error_category: sr.error_category,
        latency_ms: sr.latency_ms
      }))
    }));

    return NextResponse.json(formatted);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
