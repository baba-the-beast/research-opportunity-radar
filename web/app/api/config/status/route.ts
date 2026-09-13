import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabaseServerClient';

export const dynamic = 'force-dynamic';

export async function GET() {
  const hasUrl = Boolean(process.env.SUPABASE_URL);
  const hasKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const configured = isSupabaseConfigured();
  const allowInMemory = process.env.ALLOW_IN_MEMORY_DB === '1';

  return NextResponse.json({
    configured: configured || allowInMemory,
    database_connected: configured,
    allow_in_memory: allowInMemory,
    missing: [
      ...(!hasUrl ? ['SUPABASE_URL'] : []),
      ...(!hasKey ? ['SUPABASE_SERVICE_ROLE_KEY'] : [])
    ]
  });
}
