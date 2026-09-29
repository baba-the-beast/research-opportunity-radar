import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { safeRedirectPath } from '@/lib/safeRedirect';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeRedirectPath(searchParams.get('next'));

  if (code) {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  // Return user to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
