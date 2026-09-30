import { NextRequest } from 'next/server';
import { getOwnProfileId, getRequestSupabase } from '@/lib/routeContext';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { consumeRateLimit, rateLimitKey } from '@/lib/rateLimit';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// Fields the eligibility check uses. Empty/null means "not set": calls that restrict on it are
// flagged for manual review instead of being judged on a guess.
const ELIGIBILITY_FIELDS = [
  'designation',
  'employment_type',
  'date_of_birth',
  'superannuation_year',
  'state',
  'career_stage',
  'phd_year',
  'institution_type',
  'citizenship_status'
] as const;

function toProfileResponse(prof: any, terms: any[]) {
  return {
    id: prof?.id ?? null,
    full_name: prof?.full_name ?? '',
    institution: prof?.institution ?? '',
    department: prof?.department ?? '',
    designation: prof?.designation ?? '',
    employment_type: prof?.employment_type ?? '',
    date_of_birth: prof?.date_of_birth ?? '',
    superannuation_year: prof?.superannuation_year ?? null,
    state: prof?.state ?? '',
    career_stage: prof?.career_stage ?? '',
    phd_year: prof?.phd_year ?? null,
    institution_type: prof?.institution_type ?? '',
    citizenship_status: prof?.citizenship_status ?? '',
    research_keywords: prof?.research_keywords ?? [],
    profile_text: prof?.profile_text ?? '',
    min_relevance_band: prof?.min_relevance_band ?? 'watch',
    deadline_alert_window_days: prof?.deadline_alert_window_days ?? 30,
    profile_terms: terms.map((t: any) => ({
      term: t.term,
      term_type: t.term_type,
      weight: Number(t.weight),
      polarity: t.polarity
    }))
  };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated) {
      return auth.errorResponse!;
    }

    const supabase = getRequestSupabase(auth.user);

    // Only ever the caller's own profile. A new user gets an empty profile (not a demo one), so
    // saving it never stores someone else's research terms.
    const profileId = await getOwnProfileId(supabase, auth.user);
    if (!profileId) {
      return createSuccessResponse(toProfileResponse(null, []), req);
    }

    const { data: prof, error } = await supabase.from('faculty_profile').select('*').eq('id', profileId).single();
    if (error) {
      return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
    }
    const { data: terms } = await supabase.from('profile_terms').select('*').eq('profile_id', profileId);
    return createSuccessResponse(toProfileResponse(prof, terms || []), req);
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}

const optionalText = (max: number) => z.string().trim().max(max).optional();
const currentYear = new Date().getFullYear();

const updateProfileSchema = z.object({
  full_name: z.string().trim().min(1).max(120),
  institution: z.string().trim().min(1).max(255),
  department: optionalText(255),
  designation: optionalText(100),
  employment_type: z.enum(['', 'regular', 'contractual']).optional(),
  date_of_birth: z
    .string()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Use YYYY-MM-DD')
    .optional(),
  superannuation_year: z.number().int().min(currentYear - 5).max(2100).nullable().optional(),
  state: optionalText(100),
  career_stage: optionalText(100),
  phd_year: z.number().int().min(1950).max(currentYear).nullable().optional(),
  institution_type: optionalText(150),
  citizenship_status: optionalText(150),
  min_relevance_band: z.enum(['high', 'strong', 'watch', 'low']).optional(),
  deadline_alert_window_days: z.number().int().min(1).max(180).optional(),
  research_keywords: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
  profile_text: z.string().trim().min(1).max(10000),
  profile_terms: z
    .array(
      z.object({
        term: z.string().trim().min(1).max(100),
        term_type: z.enum(['topic', 'method', 'application', 'venue', 'funding_theme']),
        weight: z.number().min(0).max(1),
        polarity: z.enum(['positive', 'negative'])
      })
    )
    .max(100)
});

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated) {
      return auth.errorResponse!;
    }

    const roleCheck = authorizeRole(auth.user, ['faculty', 'operator', 'admin']);
    if (!roleCheck.authorized) {
      return roleCheck.errorResponse!;
    }

    const rateCheck = await consumeRateLimit(`profile_${rateLimitKey(req, auth.user)}`, 10, 60000);
    if (!rateCheck.allowed) {
      return createErrorResponse('RATE_LIMIT_EXCEEDED', 'Too many profile updates. Try again in a minute.', 429, req);
    }

    const body = await req.json();
    const parsed = updateProfileSchema.safeParse(body);
    if (!parsed.success) {
      // Name the offending fields so the profile page can tell the user what to fix
      const problems = parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
      return createErrorResponse('VALIDATION_ERROR', `Invalid profile payload (${problems})`, 400, req);
    }
    const data = parsed.data;

    const row: Record<string, any> = {
      full_name: data.full_name,
      institution: data.institution,
      department: data.department || null,
      research_keywords: data.research_keywords,
      profile_text: data.profile_text,
      // Cleared so the next pipeline run re-embeds the profile and rescores the catalog for it
      profile_embedding: null,
      updated_at: new Date().toISOString()
    };
    for (const field of ELIGIBILITY_FIELDS) {
      if (data[field] === undefined) continue;
      const value = data[field];
      // Text columns that are NOT NULL in the schema store '' for "not set"
      const notNullText = field === 'career_stage' || field === 'institution_type' || field === 'citizenship_status';
      row[field] = value === '' || value === null ? (notNullText ? '' : null) : value;
    }
    if (data.min_relevance_band) row.min_relevance_band = data.min_relevance_band;
    if (data.deadline_alert_window_days) row.deadline_alert_window_days = data.deadline_alert_window_days;

    const supabase = getRequestSupabase(auth.user);
    let profileId = await getOwnProfileId(supabase, auth.user);

    if (!profileId) {
      const { data: created, error: insErr } = await supabase
        .from('faculty_profile')
        .insert({ ...row, user_id: auth.user?.isServiceRole ? null : auth.user?.id })
        .select('id')
        .single();
      if (insErr) {
        return createErrorResponse('DATABASE_ERROR', insErr.message, 500, req);
      }
      profileId = created.id;
    } else {
      const { error: updErr } = await supabase.from('faculty_profile').update(row).eq('id', profileId);
      if (updErr) {
        return createErrorResponse('DATABASE_ERROR', updErr.message, 500, req);
      }
    }

    const { error: delErr } = await supabase.from('profile_terms').delete().eq('profile_id', profileId);
    if (delErr) {
      return createErrorResponse('DATABASE_ERROR', delErr.message, 500, req);
    }
    if (data.profile_terms.length > 0) {
      const { error: termErr } = await supabase.from('profile_terms').insert(
        data.profile_terms.map((term) => ({
          profile_id: profileId,
          term: term.term,
          term_type: term.term_type,
          weight: term.weight,
          polarity: term.polarity,
          source: 'manual'
        }))
      );
      if (termErr) {
        return createErrorResponse('DATABASE_ERROR', termErr.message, 500, req);
      }
    }

    return createSuccessResponse({ success: true, profile_id: profileId }, req);
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
