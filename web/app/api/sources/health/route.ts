import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { getRequestSupabase } from '@/lib/routeContext';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';

export const dynamic = 'force-dynamic';

export interface SourceHealth {
  source_name: string;
  checked_at: string;
  listed_count: number;
  kept_count: number;
  ok: boolean;
}

/**
 * Each funding source's most recent check (source_health, one row per source per scan). Error
 * texts stay with operators; users see whether the source was read. [] until the migration is applied.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated) {
      return auth.errorResponse!;
    }
    const { data, error } = await getRequestSupabase(auth.user)
      .from('source_health')
      .select('source_name, checked_at, listed_count, kept_count, error')
      .order('checked_at', { ascending: false })
      .limit(300);
    if (error) {
      // Table missing (migration 20261013000000 not applied): no source details yet, not a failure
      if (/source_health/.test(error.message)) return createSuccessResponse([], req);
      return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
    }
    const latest = new Map<string, SourceHealth>();
    for (const row of data ?? []) {
      if (latest.has(row.source_name)) continue;
      latest.set(row.source_name, {
        source_name: row.source_name,
        checked_at: row.checked_at,
        listed_count: row.listed_count ?? 0,
        kept_count: row.kept_count ?? 0,
        ok: !row.error
      });
    }
    return createSuccessResponse([...latest.values()].sort((a, b) => a.source_name.localeCompare(b.source_name)), req);
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
