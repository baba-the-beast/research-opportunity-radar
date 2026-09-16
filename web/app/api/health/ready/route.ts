import { NextResponse } from 'next/server';
import { getSupabaseAdminClient, isSupabaseConfigured } from '@/lib/supabaseServerClient';

export const dynamic = 'force-dynamic';

/**
 * Readiness probe: Verifies application is initialized and capable of querying database.
 */
export async function GET() {
  const allowInMemory = process.env.ALLOW_IN_MEMORY_DB === '1';

  if (!isSupabaseConfigured()) {
    if (allowInMemory) {
      return NextResponse.json({
        status: 'ready',
        database: 'in_memory_ephemeral',
        timestamp: new Date().toISOString()
      });
    }
    return NextResponse.json(
      {
        status: 'not_ready',
        reason: 'Supabase credentials unconfigured and ALLOW_IN_MEMORY_DB != 1',
        timestamp: new Date().toISOString()
      },
      { status: 503 }
    );
  }

  try {
    const supabase = getSupabaseAdminClient();
    const t0 = Date.now();
    const { error } = await supabase.from('opportunities').select('id').limit(1);
    const latencyMs = Date.now() - t0;

    if (error) {
      return NextResponse.json(
        {
          status: 'not_ready',
          reason: `Database ping failed: ${error.message}`,
          timestamp: new Date().toISOString()
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      status: 'ready',
      database: 'connected',
      latency_ms: latencyMs,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        status: 'not_ready',
        reason: `Readiness check exception: ${err.message}`,
        timestamp: new Date().toISOString()
      },
      { status: 503 }
    );
  }
}
