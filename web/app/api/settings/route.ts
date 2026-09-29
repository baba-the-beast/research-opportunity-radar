import { NextRequest } from 'next/server';
import { getRequestSupabase, hasUserAccount, requireUserAccount } from '@/lib/routeContext';
import { authenticateRequest } from '@/lib/auth';
import { consumeRateLimit, rateLimitKey } from '@/lib/rateLimit';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';
import { z } from 'zod';
import { DEFAULT_SOURCES, SOURCE_IDS } from '@/lib/sources';

export const dynamic = 'force-dynamic';

const settingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  min_score: z.number().int().min(0).max(100).optional(),
  email_alerts: z.boolean().optional(),
  telegram_alerts: z.boolean().optional(),
  // Chats are linked only through the bot (/api/telegram/webhook) so users can't point alerts at
  // someone else's chat; the settings API may only disconnect.
  telegram_chat_id: z.null().optional(),
  // Digests go out after each scheduled scan (twice a week); 'daily' is kept for older rows
  digest_frequency: z.enum(['daily', 'weekly', 'never']).optional(),
  preferred_sources: z.array(z.enum(SOURCE_IDS)).min(1).max(SOURCE_IDS.length).optional()
});

const DEFAULT_SETTINGS = {
  theme: 'system',
  min_score: 50,
  email_alerts: true,
  telegram_alerts: false,
  telegram_chat_id: null,
  digest_frequency: 'weekly',
  preferred_sources: DEFAULT_SOURCES
};

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated || !auth.user?.id) {
      return auth.errorResponse!;
    }

    if (!hasUserAccount(auth.user)) {
      return createSuccessResponse({ user_id: null, ...DEFAULT_SETTINGS }, req);
    }

    const supabase = getRequestSupabase(auth.user);

    const { data: prefs, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', auth.user.id)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
    }

    // Rows created before preferred_sources existed have no value: show the defaults
    return createSuccessResponse({ ...DEFAULT_SETTINGS, user_id: auth.user.id, ...(prefs || {}), preferred_sources: prefs?.preferred_sources?.length ? prefs.preferred_sources : DEFAULT_SOURCES }, req);
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated || !auth.user?.id) {
      return auth.errorResponse!;
    }

    const noAccount = requireUserAccount(auth.user, req);
    if (noAccount) {
      return noAccount;
    }

    const ip = rateLimitKey(req, auth.user);
    const rateCheck = await consumeRateLimit(`settings_${ip}`, 20, 60000);
    if (!rateCheck.allowed) {
      return createErrorResponse('RATE_LIMIT_EXCEEDED', 'Too many requests.', 429, req);
    }

    const body = await req.json();
    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) {
      return createErrorResponse('VALIDATION_ERROR', 'Invalid settings payload', 400, req, parsed.error.issues);
    }

    const supabase = getRequestSupabase(auth.user);

    const payload: any = {
      user_id: auth.user.id,
      ...parsed.data,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('user_preferences')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
    }

    // Log user activity
    try {
      await supabase.from('user_activity').insert({
        user_id: auth.user.id,
        event_type: 'preferences_update',
        title: 'Updated preferences',
        description: `Preferences modified: ${Object.keys(parsed.data).join(', ')}`,
        metadata: parsed.data
      });
    } catch {
      // Non-blocking
    }

    return createSuccessResponse(data, req);
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
