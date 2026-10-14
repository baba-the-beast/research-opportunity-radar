import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { getRequestSupabase } from '@/lib/routeContext';
import { consumeRateLimit, rateLimitKey } from '@/lib/rateLimit';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';
import { matchKnownInstitutions, mergeSuggestions } from '@/lib/institutions';

export const dynamic = 'force-dynamic';

/** Institution names for the profile picker: names colleagues already use first, then known ones. */
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated || !auth.user) return auth.errorResponse!;
    const rate = await consumeRateLimit(`institutions_${rateLimitKey(req, auth.user)}`, 120, 60000);
    if (!rate.allowed) return createErrorResponse('RATE_LIMIT_EXCEEDED', 'Too many lookups.', 429, req);

    const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 100);
    if (q.length < 2) return createSuccessResponse([], req);

    // Optional: before migration 20261014000000 only the built-in list is suggested
    const { data } = await getRequestSupabase(auth.user).rpc('institution_suggestions', { q });
    const used = Array.isArray(data) ? data.map((r: { name: string }) => r.name).filter(Boolean) : [];
    return createSuccessResponse(mergeSuggestions(used, matchKnownInstitutions(q)), req);
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
