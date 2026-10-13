import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRequestSupabase, requireUserAccount, UUID_PATTERN } from '@/lib/routeContext';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { consumeRateLimit, rateLimitKey } from '@/lib/rateLimit';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';
import { NOTES_MAX } from '@/lib/applications';
import { MY_DEADLINE_LABEL_MAX } from '@/lib/reminders';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a calendar date that exists. Date.parse rolls 2026-02-31 over to 3 March instead of rejecting it. */
function isRealDate(iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  return y >= 1900 && at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
}

/** A user's private fields on a call. Send only the fields being changed. */
const personalSchema = z
  .object({
    notes: z.string().max(NOTES_MAX).optional(),
    my_deadline: z
      .string()
      .regex(ISO_DATE, 'Use YYYY-MM-DD')
      .refine(isRealDate, 'Not a real date')
      .nullable()
      .optional(),
    my_deadline_label: z.string().trim().max(MY_DEADLINE_LABEL_MAX).optional()
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

/** Private notes and the user's own deadline on a call. Creates the tracking row if needed without touching its status. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params; // Next 15: params is async
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated || !auth.user?.id) {
      return auth.errorResponse!;
    }
    const noAccount = requireUserAccount(auth.user, req);
    if (noAccount) {
      return noAccount;
    }
    const roleCheck = authorizeRole(auth.user, ['faculty', 'operator', 'admin']);
    if (!roleCheck.authorized) {
      return roleCheck.errorResponse!;
    }

    // Notes autosave while typing, so allow a steadier rate than status changes
    const rateCheck = await consumeRateLimit(`personal_${rateLimitKey(req, auth.user)}`, 60, 60000);
    if (!rateCheck.allowed) {
      return createErrorResponse('RATE_LIMIT_EXCEEDED', 'Too many updates. Wait a moment and try again.', 429, req);
    }

    const id = rawId?.trim();
    if (!id || !UUID_PATTERN.test(id)) {
      return createErrorResponse('INVALID_IDENTIFIER', 'Invalid opportunity identifier format', 400, req);
    }

    const parsed = personalSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return createErrorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message || 'Invalid payload', 400, req, parsed.error.issues);
    }

    const supabase = getRequestSupabase(auth.user);
    // Upsert sends only these columns, so an existing row keeps its status and saved flag
    const { error } = await supabase.from('user_opportunity_state').upsert(
      {
        user_id: auth.user.id,
        opportunity_id: id,
        ...parsed.data,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id,opportunity_id' }
    );
    if (error && /my_deadline/.test(error.message)) {
      return createErrorResponse('NOT_AVAILABLE_YET', 'Personal deadlines need a database update that has not been applied yet.', 409, req);
    }
    if (error) {
      return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
    }
    return createSuccessResponse(parsed.data, req);
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
