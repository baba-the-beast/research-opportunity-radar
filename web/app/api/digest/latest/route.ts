import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServerClient';

export async function GET() {
  try {
    const supabase = getSupabaseServerClient();
    const { data: runs } = await supabase
      .from('run_log')
      .select('*')
      .eq('status', 'success')
      .order('started_at', { ascending: false })
      .limit(1);

    const latest = runs?.[0];

    const markdown = `# Weekly Opportunity Digest
Generated: ${latest?.finished_at ? new Date(latest.finished_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]}

- Opportunities found: ${latest?.opportunities_found || 0}
- Opportunities new: ${latest?.opportunities_new || 0}

Refer to dashboard for interactive component scoring details and direct citations.
`;

    return NextResponse.json({
      generated_at: latest?.finished_at || new Date().toISOString(),
      markdown
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
