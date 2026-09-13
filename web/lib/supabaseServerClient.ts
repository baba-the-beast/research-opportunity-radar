import { createClient } from '@supabase/supabase-js';

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getSupabaseServerClient() {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'SUPABASE_CONFIGURATION_REQUIRED: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not configured. ' +
      'Please copy .env.example to .env.local and configure your Supabase credentials.'
    );
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false }
  });
}
