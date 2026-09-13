import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServerClient';
import { validateApiAuth } from '@/lib/apiAuth';
import { z } from 'zod';

const statusSchema = z.object({
  status: z.enum(['new', 'pursuing', 'dismissed']),
  feedback_text: z.string().max(2000).optional(),
  negative_terms: z.array(z.string().trim().min(1).max(100)).max(25).optional()
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const auth = validateApiAuth(req);
    if (!auth.authorized && auth.response) {
      return auth.response;
    }

    const id = params?.id?.trim();
    if (!id || !/^[a-zA-Z0-9_\-\.]{1,64}$/.test(id)) {
      return NextResponse.json({ error: 'Invalid opportunity identifier format' }, { status: 400 });
    }

    const body = await req.json();
    const parsed = statusSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid status', details: parsed.error.issues }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    // Get single faculty profile
    const { data: prof } = await supabase.from('faculty_profile').select('id').single();

    if (!prof) {
      return NextResponse.json({ error: 'Faculty profile not found' }, { status: 404 });
    }

    const { error } = await supabase
      .from('opportunity_status')
      .upsert({
        opportunity_id: id,
        faculty_id: prof.id,
        status: parsed.data.status,
        updated_at: new Date().toISOString(),
        updated_by: 'faculty'
      }, { onConflict: 'opportunity_id' });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
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

    return NextResponse.json({ status: parsed.data.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
