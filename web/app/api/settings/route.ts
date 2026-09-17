import { NextRequest } from 'next/server';
import { getSupabaseUserClient, getSupabaseAdminClient } from '@/lib/supabaseServerClient';
import { authenticateRequest } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const settingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  min_score: z.number().int().min(0).max(100).optional(),
  email_alerts: z.boolean().optional(),
  telegram_alerts: z.boolean().optional(),
  telegram_chat_id: z.string().max(64).nullable().optional(),
  digest_frequency: z.enum(['daily', 'weekly', 'never']).optional(),
  auto_summarize: z.boolean().optional()
});

const DEFAULT_SETTINGS = {
  theme: 'system',
  min_score: 50,
  email_alerts: true,
  telegram_alerts: false,
  telegram_chat_id: null,
  digest_frequency: 'weekly',
  auto_summarize: true
};

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated || !auth.user?.id) {
      return auth.errorResponse!;
    }

    const supabase = auth.user.isServiceRole
      ? getSupabaseAdminClient()
      : getSupabaseUserClient(auth.user.token);

    const { data: prefs, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', auth.user.id)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
    }

    return createSuccessResponse(prefs || { user_id: auth.user.id, ...DEFAULT_SETTINGS }, req);
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

    const ip = getClientIp(req);
    const rateCheck = checkRateLimit(`settings_${ip}`, 20, 60000);
    if (!rateCheck.allowed) {
      return createErrorResponse('RATE_LIMIT_EXCEEDED', 'Too many requests.', 429, req);
    }

    const body = await req.json();
    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) {
      return createErrorResponse('VALIDATION_ERROR', 'Invalid settings payload', 400, req, parsed.error.issues);
    }

    const supabase = auth.user.isServiceRole
      ? getSupabaseAdminClient()
      : getSupabaseUserClient(auth.user.token);

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
        title: 'Updated Observatory Preferences',
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
