import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/**
 * Returns a browser-side singleton Supabase client configured for cookie auth.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (typeof window === 'undefined') {
    throw new Error('getSupabaseBrowserClient must only be called in the browser runtime.');
  }

  if (client) {
    return client;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    // Return a dummy/offline client if env vars are missing during build or offline dev
    client = createBrowserClient(
      supabaseUrl || 'https://placeholder.supabase.co',
      supabaseAnonKey || 'placeholder-anon-key'
    );
    return client;
  }

  // Auth requests go through this site's /supabase proxy (next.config.js rewrites), so sign-in
  // works where the browser cannot reach *.supabase.co. The cookie keeps the name derived from the
  // real project URL, which is the name the server-side clients and middleware read.
  client = createBrowserClient(`${window.location.origin}/supabase`, supabaseAnonKey, {
    cookieOptions: { name: authCookieName(supabaseUrl) }
  });
  return client;
}

/** Supabase's default auth cookie name for a project URL: sb-<project-ref>-auth-token. */
export function authCookieName(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
}
