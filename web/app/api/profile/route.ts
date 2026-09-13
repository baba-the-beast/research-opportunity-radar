import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServerClient';
import { validateApiAuth } from '@/lib/apiAuth';
import { z } from 'zod';

export async function GET() {
  try {
    const supabase = getSupabaseServerClient();
    const { data: prof, error } = await supabase.from('faculty_profile').select('*').single();
    if (error || !prof) {
      return NextResponse.json(
        { error: error?.message || 'Faculty profile not found in database. Configure Supabase or insert profile.' },
        { status: 404 }
      );
    }

    const { data: terms } = await supabase.from('profile_terms').select('*').eq('profile_id', prof.id);

    return NextResponse.json({
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
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
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

export async function POST(req: Request) {
  try {
    const auth = validateApiAuth(req);
    if (!auth.authorized && auth.response) {
      return auth.response;
    }

    const body = await req.json();
    const parsed = updateProfileSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid profile payload', details: parsed.error.issues }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const { data: prof } = await supabase.from('faculty_profile').select('id').single();
    if (!prof) {
      return NextResponse.json({ error: 'Faculty profile not found' }, { status: 404 });
    }

    const updateData: any = {
      research_keywords: parsed.data.research_keywords,
      profile_text: parsed.data.profile_text,
      updated_at: new Date().toISOString()
    };
    if (parsed.data.full_name) updateData.full_name = parsed.data.full_name;
    if (parsed.data.institution) updateData.institution = parsed.data.institution;
    if (parsed.data.department) updateData.department = parsed.data.department;
    if (parsed.data.career_stage) updateData.career_stage = parsed.data.career_stage;
    if (parsed.data.phd_year !== undefined) updateData.phd_year = parsed.data.phd_year;
    if (parsed.data.institution_type) updateData.institution_type = parsed.data.institution_type;
    if (parsed.data.citizenship_status) updateData.citizenship_status = parsed.data.citizenship_status;

    await supabase.from('faculty_profile').update(updateData).eq('id', prof.id);

    await supabase.from('profile_terms').delete().eq('profile_id', prof.id);
    for (const term of parsed.data.profile_terms) {
      await supabase.from('profile_terms').insert({
        profile_id: prof.id,
        term: term.term,
        term_type: term.term_type,
        weight: term.weight,
        polarity: term.polarity,
        source: 'manual'
      });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
