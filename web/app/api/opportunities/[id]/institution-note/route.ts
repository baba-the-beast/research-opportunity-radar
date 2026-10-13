import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRequestSupabase, requireUserAccount, UUID_PATTERN } from '@/lib/routeContext';
import { authenticateRequest } from '@/lib/auth';
import { consumeRateLimit, rateLimitKey } from '@/lib/rateLimit';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';
import { institutionKey } from '@/lib/institution';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const noteSchema = z.object({
  internal_deadline: z.string().regex(ISO_DATE, 'Use YYYY-MM-DD').nullable(),
  note: z.string().trim().max(1000),
  recommended: z.boolean()
});

/** The caller's institution (from their profile), or '' when it is not set. */
async function myInstitution(supabase: ReturnType<typeof getRequestSupabase>, userId: string): Promise<string> {
  const { data } = await supabase.from('faculty_profile').select('institution').eq('user_id', userId).maybeSingle();
  return data?.institution || '';
}

/**
 * The research office's note on this call for the caller's institution: internal deadline, note and
 * whether it is recommended. `can_edit` is true for research office accounts. RLS limits rows to the
 * caller's own institution.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated || !auth.user?.id) return auth.errorResponse!;
    if (!UUID_PATTERN.test(id)) return createErrorResponse('INVALID_IDENTIFIER', 'Invalid opportunity identifier format', 400, req);

    const supabase = getRequestSupabase(auth.user);
    const institution = await myInstitution(supabase, auth.user.id);
    const canEdit = auth.user.role === 'research_office' && Boolean(institutionKey(institution));
    if (!institutionKey(institution)) {
      return createSuccessResponse({ institution: '', note: null, can_edit: false }, req);
    }
    const { data, error } = await supabase
      .from('institution_call_notes')
      .select('internal_deadline, note, recommended, updated_at')
      .eq('institution_key', institutionKey(institution))
      .eq('opportunity_id', id)
      .maybeSingle();
    if (error && /institution_call_notes/.test(error.message)) {
      return createSuccessResponse({ institution, note: null, can_edit: false }, req); // migration not applied yet
    }
    if (error) return createErrorResponse('DATABASE_ERROR', error.message, 500, req);

    let facultyCount: number | null = null;
    if (canEdit) {
      const { data: count } = await supabase.rpc('my_institution_faculty_count');
      facultyCount = typeof count === 'number' ? count : null;
    }
    return createSuccessResponse({ institution, note: data ?? null, can_edit: canEdit, faculty_count: facultyCount }, req);
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}

/** Research office only: set this call's internal deadline, note and recommendation for its institution. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated || !auth.user?.id) return auth.errorResponse!;
    const noAccount = requireUserAccount(auth.user, req);
    if (noAccount) return noAccount;
    if (auth.user.role !== 'research_office' && auth.user.role !== 'admin') {
      return createErrorResponse('FORBIDDEN', 'Only a research office account can set notes for the institution.', 403, req);
    }
    if (!UUID_PATTERN.test(id)) return createErrorResponse('INVALID_IDENTIFIER', 'Invalid opportunity identifier format', 400, req);
    const rate = await consumeRateLimit(`institution_note_${rateLimitKey(req, auth.user)}`, 30, 60000);
    if (!rate.allowed) return createErrorResponse('RATE_LIMIT_EXCEEDED', 'Too many updates. Wait a moment and try again.', 429, req);

    const parsed = noteSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return createErrorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message || 'Invalid payload', 400, req, parsed.error.issues);
    }
    const supabase = getRequestSupabase(auth.user);
    const key = institutionKey(await myInstitution(supabase, auth.user.id));
    if (!key) {
      return createErrorResponse('NO_INSTITUTION', 'Set your institution in Profile first: notes apply to that institution.', 400, req);
    }
    const { error } = await supabase.from('institution_call_notes').upsert(
      { institution_key: key, opportunity_id: id, ...parsed.data, updated_by: auth.user.id, updated_at: new Date().toISOString() },
      { onConflict: 'institution_key,opportunity_id' }
    );
    if (error && /institution_call_notes/.test(error.message)) {
      return createErrorResponse('NOT_AVAILABLE_YET', 'Research office notes need a database update that has not been applied yet.', 409, req);
    }
    if (error) return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
    return createSuccessResponse(parsed.data, req);
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
