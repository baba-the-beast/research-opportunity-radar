import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextResponse } from 'next/server';
import { createErrorResponse } from './apiResponse';
import type { UserIdentity } from './auth';
import { getSupabaseAdminClient, getSupabaseUserClient } from './supabaseServerClient';

/**
 * Supabase client for a route handler: service-role identities (operator secret, local dev)
 * use the admin client; everyone else gets a client bound to their own JWT so RLS applies.
 */
export function getRequestSupabase(user: UserIdentity | undefined): SupabaseClient {
  return user?.isServiceRole ? getSupabaseAdminClient() : getSupabaseUserClient(user?.token);
}

/**
 * The caller's own faculty_profile id, or null if they have not created one yet.
 * Service-role identities have no auth.users row, so they act on the oldest (legacy seed) profile.
 */
export async function getOwnProfileId(
  supabase: SupabaseClient,
  user: UserIdentity | undefined
): Promise<string | null> {
  let query = supabase.from('faculty_profile').select('id');
  query = user?.isServiceRole
    ? query.order('created_at', { ascending: true })
    : query.eq('user_id', user?.id ?? '');
  const { data, error } = await query.limit(1);
  if (error) {
    throw new Error(`faculty_profile lookup failed: ${error.message}`);
  }
  return data?.[0]?.id ?? null;
}

/** PostgREST UUID guard for ids that arrive from URLs, request bodies, or LLM tool calls. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Per-user tables (user_opportunity_state, user_preferences, user_activity, chat_*) key on
 * auth.users(id). Operator-secret and local-dev identities have no such row, so writes would fail
 * with a uuid/FK error; return a clear 403 instead. Returns null when the caller is a real user.
 */
export function requireUserAccount(user: UserIdentity | undefined, req: Request): NextResponse | null {
  if (hasUserAccount(user)) {
    return null;
  }
  return createErrorResponse(
    'USER_ACCOUNT_REQUIRED',
    'This action tracks per-user state and needs a signed-in user account (operator and local-dev identities have none).',
    403,
    req
  );
}

/** True when reads of per-user tables should short-circuit to empty/default results. */
export function hasUserAccount(user: UserIdentity | undefined): boolean {
  return Boolean(user && !user.isServiceRole && UUID_PATTERN.test(user.id));
}
