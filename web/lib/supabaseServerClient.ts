import { createClient, SupabaseClient } from '@supabase/supabase-js';

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY));
}

/**
 * Creates a user-scoped Supabase client that forwards the caller's JWT.
 * Postgres Row Level Security (RLS) is strictly evaluated against auth.uid().
 */
export function getSupabaseUserClient(authToken?: string): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const key = anonKey || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !key) {
    throw new Error(
      'SUPABASE_CONFIGURATION_REQUIRED: SUPABASE_URL and SUPABASE_ANON_KEY must be configured.'
    );
  }

  // With the service-role key as apikey, PostgREST only applies RLS when a user JWT overrides
  // the Authorization header. Without one, this "user" client would silently bypass RLS.
  if (!anonKey && !authToken) {
    throw new Error(
      'SUPABASE_CONFIGURATION_REQUIRED: SUPABASE_ANON_KEY must be configured to create a user client without a session token.'
    );
  }

  return createClient(supabaseUrl, key, {
    auth: { persistSession: false },
    global: authToken
      ? {
          headers: {
            Authorization: `Bearer ${authToken}`
          }
        }
      : undefined
  });
}

/**
 * Returns a privileged Supabase client using SUPABASE_SERVICE_ROLE_KEY.
 * WARNING: Bypasses Row Level Security entirely.
 * Restrict usage to trusted worker operations, migrations, and admin endpoints.
 */
export function getSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      'SUPABASE_CONFIGURATION_REQUIRED: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for privileged admin operations.'
    );
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false }
  });
}
