import { NextResponse } from 'next/server';
import { getSupabaseAdminClient, isSupabaseConfigured } from '@/lib/supabaseServerClient';

export const dynamic = 'force-dynamic';

/**
 * Dependency health probe: Reports connectivity and health status across integrated external services.
 */
export async function GET() {
  const results: Record<string, any> = {
    timestamp: new Date().toISOString()
  };

  // 1. Supabase Database check
  if (!isSupabaseConfigured()) {
    results.database = {
      status: process.env.ALLOW_IN_MEMORY_DB === '1' ? 'mock_in_memory' : 'unconfigured'
    };
  } else {
    try {
      const supabase = getSupabaseAdminClient();
      const t0 = Date.now();
      const { error } = await supabase.from('opportunities').select('id').limit(1);
      results.database = {
        status: error ? 'degraded' : 'healthy',
        latency_ms: Date.now() - t0,
        error: error ? error.message : undefined
      };
    } catch (e: any) {
      results.database = {
        status: 'down',
        error: e.message
      };
    }
  }

  // 2. OpenAlex API check
  try {
    const t0 = Date.now();
    const res = await fetch('https://api.openalex.org/works?per_page=1', {
      headers: { 'User-Agent': 'ResearchOpportunityRadar/1.0' },
      next: { revalidate: 60 }
    });
    results.openalex = {
      status: res.ok ? 'healthy' : 'degraded',
      http_status: res.status,
      latency_ms: Date.now() - t0
    };
  } catch (e: any) {
    results.openalex = {
      status: 'down',
      error: e.message
    };
  }

  const isHealthy = Object.values(results).every(
    (dep) => typeof dep !== 'object' || dep.status === 'healthy' || dep.status === 'mock_in_memory'
  );

  return NextResponse.json(results, { status: isHealthy ? 200 : 207 });
}
