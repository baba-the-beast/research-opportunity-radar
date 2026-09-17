import { NextRequest } from 'next/server';
import { getSupabaseAdminClient, getSupabaseUserClient } from '@/lib/supabaseServerClient';
import { authenticateRequest } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';
import { runCopilotTurn, ChatMessage } from '@/lib/ai/llmProvider';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const chatSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  session_id: z.string().uuid().optional()
});

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated || !auth.user?.id) {
      return auth.errorResponse!;
    }

    const ip = getClientIp(req);
    const rateCheck = checkRateLimit(`chat_${ip}`, 30, 60000);
    if (!rateCheck.allowed) {
      return createErrorResponse('RATE_LIMIT_EXCEEDED', 'Too many chat requests. Please slow down.', 429, req);
    }

    const body = await req.json();
    const parsed = chatSchema.safeParse(body);
    if (!parsed.success) {
      return createErrorResponse('VALIDATION_ERROR', 'Invalid message payload', 400, req, parsed.error.issues);
    }

    const supabase = auth.user.isServiceRole
      ? getSupabaseAdminClient()
      : getSupabaseUserClient(auth.user.token);

    let sessionId = parsed.data.session_id;

    // 1. Ensure or create a valid chat session
    if (!sessionId) {
      const { data: newSession, error: sErr } = await supabase
        .from('chat_sessions')
        .insert({
          user_id: auth.user.id,
          title: parsed.data.message.slice(0, 40) + '...'
        })
        .select('id')
        .single();

      if (!sErr && newSession) {
        sessionId = newSession.id;
      }
    }

    // 2. Load recent conversation history
    const messageHistory: ChatMessage[] = [];
    if (sessionId) {
      const { data: pastMessages } = await supabase
        .from('chat_messages')
        .select('role, content, tool_calls')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
        .limit(10);

      if (pastMessages) {
        for (const m of pastMessages) {
          messageHistory.push({
            role: m.role as any,
            content: m.content
          });
        }
      }
    }

    // Add current user message
    messageHistory.push({
      role: 'user',
      content: parsed.data.message
    });

    // 3. Persist user message
    if (sessionId) {
      try {
        await supabase.from('chat_messages').insert({
          session_id: sessionId,
          user_id: auth.user.id,
          role: 'user',
          content: parsed.data.message
        });
      } catch {
        // Tolerant if table not migrated
      }
    }

    // 4. Run Copilot inference turn
    const result = await runCopilotTurn(messageHistory, auth.user.id);

    // 5. Persist assistant message
    if (sessionId) {
      try {
        await supabase.from('chat_messages').insert({
          session_id: sessionId,
          user_id: auth.user.id,
          role: 'assistant',
          content: result.text,
          tool_calls: result.executedTools.length > 0 ? result.executedTools : null
        });

        // Audit in user_activity
        await supabase.from('user_activity').insert({
          user_id: auth.user.id,
          event_type: 'chat_message',
          title: 'Consulted AI Research Copilot',
          description: parsed.data.message.slice(0, 100),
          metadata: {
            session_id: sessionId,
            tools_called: result.executedTools.map((t) => t.name)
          }
        });
      } catch {
        // Tolerant
      }
    }

    return createSuccessResponse(
      {
        session_id: sessionId,
        message: result.text,
        tools_executed: result.executedTools
      },
      req
    );
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated || !auth.user?.id) {
      return auth.errorResponse!;
    }

    const supabase = auth.user.isServiceRole
      ? getSupabaseAdminClient()
      : getSupabaseUserClient(auth.user.token);

    const { data: sessions, error } = await supabase
      .from('chat_sessions')
      .select('id, title, created_at, updated_at')
      .eq('user_id', auth.user.id)
      .order('updated_at', { ascending: false })
      .limit(10);

    if (error) {
      return createSuccessResponse({ sessions: [] }, req);
    }

    return createSuccessResponse({ sessions: sessions || [] }, req);
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
