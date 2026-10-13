import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRequestSupabase, requireUserAccount, UUID_PATTERN } from '@/lib/routeContext';
import { authenticateRequest } from '@/lib/auth';
import { consumeRateLimit, rateLimitKey } from '@/lib/rateLimit';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';
import { CORRECTIONS } from '@/lib/eligibility';

const correctionSchema = z.object({
  rule_name: z.string().regex(/^[A-Z_]{1,64}$/),
  verdict_shown: z.enum(['PASS', 'FAIL', 'WARNING', 'NEEDS_MANUAL_REVIEW']),
  correction: z.enum(CORRECTIONS.map((c) => c.value) as [string, ...string[]]),
  comment: z.string().trim().max(1000).default(''),
  excerpt: z.string().max(2000).nullable().optional()
});

/** Records that the user thinks one eligibility check on this call is wrong. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated || !auth.user?.id) {
      return auth.errorResponse!;
    }
    const noAccount = requireUserAccount(auth.user, req);
    if (noAccount) {
      return noAccount;
    }
    const rate = await consumeRateLimit(`eligibility_correction_${rateLimitKey(req, auth.user)}`, 10, 60000);
    if (!rate.allowed) {
      return createErrorResponse('RATE_LIMIT_EXCEEDED', 'Too many reports. Wait a minute and try again.', 429, req);
    }
    const id = rawId?.trim();
    if (!id || !UUID_PATTERN.test(id)) {
      return createErrorResponse('INVALID_IDENTIFIER', 'Invalid opportunity identifier format', 400, req);
    }
    const parsed = correctionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return createErrorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message || 'Invalid payload', 400, req, parsed.error.issues);
    }

    const { error } = await getRequestSupabase(auth.user)
      .from('eligibility_corrections')
      .insert({ user_id: auth.user.id, opportunity_id: id, ...parsed.data, excerpt: parsed.data.excerpt ?? null });
    if (error && /eligibility_corrections/.test(error.message)) {
      return createErrorResponse('NOT_AVAILABLE_YET', 'Reporting a wrong verdict needs a database update that has not been applied yet.', 409, req);
    }
    if (error) {
      return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
    }
    return createSuccessResponse({ recorded: true }, req);
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
