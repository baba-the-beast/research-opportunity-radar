import { NextRequest } from 'next/server';
import { getSupabaseUserClient, getSupabaseAdminClient } from '@/lib/supabaseServerClient';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';
import { z } from 'zod';

const statusSchema = z.object({
  status: z.enum(['new', 'pursuing', 'dismissed']),
  feedback_text: z.string().max(2000).optional(),
  negative_terms: z.array(z.string().trim().min(1).max(100)).max(25).optional()
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // 1. Authentication
    const auth = await authenticateRequest(req);
    if (!auth.authenticated) {
      return auth.errorResponse!;
    }

    // 2. Authorization
    const roleCheck = authorizeRole(auth.user, ['faculty', 'operator', 'admin']);
    if (!roleCheck.authorized) {
      return roleCheck.errorResponse!;
    }

    // 3. Sanitized Rate Limiting
    const ip = getClientIp(req);
    const rateCheck = checkRateLimit(`status_${ip}`, 20, 60000);
    if (!rateCheck.allowed) {
      return createErrorResponse(
        'RATE_LIMIT_EXCEEDED',
        'Rate limit exceeded: Too many status update requests.',
        429,
        req
      );
    }

    const id = params?.id?.trim();
    if (!id || !/^[a-zA-Z0-9_\-\.]{1,64}$/.test(id)) {
      return createErrorResponse('INVALID_IDENTIFIER', 'Invalid opportunity identifier format', 400, req);
    }

    const body = await req.json();
    const parsed = statusSchema.safeParse(body);
    if (!parsed.success) {
      return createErrorResponse('VALIDATION_ERROR', 'Invalid status payload', 400, req, parsed.error.issues);
    }

    // Use admin client if operator or user client if authenticated user
    const supabase = auth.user?.isServiceRole
      ? getSupabaseAdminClient()
      : getSupabaseUserClient(auth.user?.token);

    // Lookup faculty profile associated with user
    let profQuery = supabase.from('faculty_profile').select('id');
    if (auth.user?.id && auth.user.role === 'faculty') {
      profQuery = profQuery.eq('user_id', auth.user.id);
    }
    const { data: profs } = await profQuery.limit(1);
    const prof = profs?.[0];

    if (!prof) {
      return createErrorResponse('NOT_FOUND', 'Faculty profile not found for authenticated user', 404, req);
    }

    const { error } = await supabase
      .from('opportunity_status')
      .upsert({
        opportunity_id: id,
        faculty_id: prof.id,
        status: parsed.data.status,
        updated_at: new Date().toISOString(),
        updated_by: auth.user?.role || 'faculty'
      }, { onConflict: 'opportunity_id' });

    if (error) {
      return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
    }

    // Feedback loop: If faculty dismisses the opportunity, record as not_relevant
    if (parsed.data.status === 'dismissed') {
      let negativeTerms = parsed.data.negative_terms || [];
      if (negativeTerms.length === 0) {
        const { data: oppData } = await supabase
          .from('opportunities')
          .select('title, summary')
          .eq('id', params.id)
          .single();
        if (oppData?.title) {
          const words = oppData.title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w: string) => w.length > 3);
          const stopWords = new Set(['with', 'from', 'this', 'that', 'call', 'proposals', 'special', 'issue', 'journal', 'research']);
          negativeTerms = Array.from(new Set(words.filter((w: string) => !stopWords.has(w)))).slice(0, 5) as string[];
        }
      }

      await supabase.from('feedback').insert({
        opportunity_id: params.id,
        faculty_id: prof.id,
        rating: 'not_relevant',
        feedback_text: parsed.data.feedback_text || 'Dismissed by faculty',
        negative_terms: negativeTerms,
        created_at: new Date().toISOString()
      });
    }

    return createSuccessResponse({ status: parsed.data.status }, req);
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
