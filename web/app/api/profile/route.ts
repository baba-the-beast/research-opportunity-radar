import { NextRequest } from 'next/server';
import { getOwnProfileId, getRequestSupabase } from '@/lib/routeContext';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { consumeRateLimit, getClientIp } from '@/lib/rateLimit';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated) {
      return auth.errorResponse!;
    }

    const supabase = getRequestSupabase(auth.user);

    // Only ever the caller's own profile. New users get the uncalibrated default below rather
    // than another faculty member's (or the legacy seed) profile.
    const profileId = await getOwnProfileId(supabase, auth.user);
    let prof: any = null;
    if (profileId) {
      const { data, error } = await supabase.from('faculty_profile').select('*').eq('id', profileId).single();
      if (error) {
        return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
      }
      prof = data;
    }

    if (!prof) {
      // Return uncalibrated default profile for new user
      return createSuccessResponse(
        {
          id: null,
          full_name: 'New Investigator',
          institution: 'Institutional Affiliation',
          department: 'Academic Department',
          career_stage: 'mid_career',
          phd_year: 2021,
          institution_type: 'tier1_research',
          citizenship_status: 'citizen',
          research_keywords: ['Academic Research', 'Discovery'],
          profile_text: 'Profile not yet calibrated. Add research keywords and summary to train relevance scoring.',
          min_relevance_band: 'watch',
          profile_terms: []
        },
        req
      );
    }

    const { data: terms } = await supabase.from('profile_terms').select('*').eq('profile_id', prof.id);

    return createSuccessResponse(
      {
        id: prof.id,
        full_name: prof.full_name,
        institution: prof.institution,
        department: prof.department,
        career_stage: prof.career_stage || 'Assistant Professor',
        phd_year: prof.phd_year || 2021,
        institution_type: prof.institution_type || 'R1 Doctoral University (IHE)',
        citizenship_status: prof.citizenship_status || 'US Citizen or Permanent Resident',
        research_keywords: prof.research_keywords,
        profile_text: prof.profile_text,
        min_relevance_band: prof.min_relevance_band,
        profile_terms: (terms || []).map((t: any) => ({
          term: t.term,
          term_type: t.term_type,
          weight: Number(t.weight),
          polarity: t.polarity
        }))
      },
      req
    );
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}

const updateProfileSchema = z.object({
  full_name: z.string().trim().min(1).max(120).optional(),
  institution: z.string().trim().min(1).max(255).optional(),
  department: z.string().trim().max(255).optional(),
  career_stage: z.string().trim().max(100).optional(),
  phd_year: z.number().int().min(1950).max(2050).optional(),
  institution_type: z.string().trim().max(150).optional(),
  citizenship_status: z.string().trim().max(150).optional(),
  research_keywords: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
  profile_text: z.string().max(10000),
  profile_terms: z.array(z.object({
    term: z.string().trim().min(1).max(100),
    term_type: z.enum(['topic', 'method', 'application', 'venue', 'funding_theme']),
    weight: z.number().min(0).max(1),
    polarity: z.enum(['positive', 'negative'])
  })).max(100)
});

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated) {
      return auth.errorResponse!;
    }

    const roleCheck =  authorizeRole(auth.user, ['faculty', 'operator', 'admin']);
    if (!roleCheck.authorized) {
      return roleCheck.errorResponse!;
    }

    const ip = getClientIp(req);
    const rateCheck = await consumeRateLimit(`profile_${ip}`, 10, 60000);
    if (!rateCheck.allowed) {
      return createErrorResponse(
        'RATE_LIMIT_EXCEEDED',
        'Rate limit exceeded: Too many profile update requests.',
        429,
        req
      );
    }

    const body = await req.json();
    const parsed = updateProfileSchema.safeParse(body);
    if (!parsed.success) {
      return createErrorResponse('VALIDATION_ERROR', 'Invalid profile payload', 400, req, parsed.error.issues);
    }

    const supabase = getRequestSupabase(auth.user);
    let profileId = await getOwnProfileId(supabase, auth.user);

    if (!profileId) {
      // Auto-provision faculty_profile for new user
      const insertData: any = {
        user_id: auth.user?.isServiceRole ? null : auth.user?.id,
        full_name: parsed.data.full_name || 'Investigator',
        institution: parsed.data.institution || 'University',
        department: parsed.data.department || 'Department',
        career_stage: parsed.data.career_stage || 'mid_career',
        phd_year: parsed.data.phd_year || 2021,
        institution_type: parsed.data.institution_type || 'tier1_research',
        citizenship_status: parsed.data.citizenship_status || 'citizen',
        research_keywords: parsed.data.research_keywords,
        profile_text: parsed.data.profile_text,
        updated_at: new Date().toISOString()
      };

      const { data: newProf, error: insErr } = await supabase
        .from('faculty_profile')
        .insert(insertData)
        .select('id')
        .single();

      if (insErr) {
        return createErrorResponse('DATABASE_ERROR', insErr.message, 500, req);
      }
      profileId = newProf.id;
    } else {
      const updateData: any = {
        research_keywords: parsed.data.research_keywords,
        profile_text: parsed.data.profile_text,
        // Cleared so the next pipeline run re-embeds the profile and rescores the catalog for it
        profile_embedding: null,
        updated_at: new Date().toISOString()
      };
      if (parsed.data.full_name) updateData.full_name = parsed.data.full_name;
      if (parsed.data.institution) updateData.institution = parsed.data.institution;
      if (parsed.data.department) updateData.department = parsed.data.department;
      if (parsed.data.career_stage) updateData.career_stage = parsed.data.career_stage;
      if (parsed.data.phd_year !== undefined) updateData.phd_year = parsed.data.phd_year;
      if (parsed.data.institution_type) updateData.institution_type = parsed.data.institution_type;
      if (parsed.data.citizenship_status) updateData.citizenship_status = parsed.data.citizenship_status;

      const { error: updErr } = await supabase.from('faculty_profile').update(updateData).eq('id', profileId);
      if (updErr) {
        return createErrorResponse('DATABASE_ERROR', updErr.message, 500, req);
      }
    }

    const { error: delErr } = await supabase.from('profile_terms').delete().eq('profile_id', profileId);
    if (delErr) {
      return createErrorResponse('DATABASE_ERROR', delErr.message, 500, req);
    }
    if (parsed.data.profile_terms.length > 0) {
      const { error: termErr } = await supabase.from('profile_terms').insert(
        parsed.data.profile_terms.map((term) => ({
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
