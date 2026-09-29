import { NextRequest } from 'next/server';
import { getRequestSupabase } from '@/lib/routeContext';
import { authenticateRequest } from '@/lib/auth';
import { consumeRateLimit, getClientIp } from '@/lib/rateLimit';
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

    // 1. Dual-Key Rate Limiting: Per-IP (25 req/min) to accommodate institutional proxy/NAT environments
    const ipRateCheck = await consumeRateLimit(`chat_ip_${ip}`, 25, 60000);
    if (!ipRateCheck.allowed) {
      return createErrorResponse(
        'RATE_LIMIT_EXCEEDED',
        'Rate limit exceeded: Too many chat requests from this network address. Please wait a minute.',
        429,
        req
      );
    }

    // 2. Dual-Key Rate Limiting: Per-User (10 req/min) to guard LLM API quota and prevent runaway automation
    const userRateCheck = await consumeRateLimit(`chat_usr_${auth.user.id}`, 10, 60000);
    if (!userRateCheck.allowed) {
      return createErrorResponse(
        'RATE_LIMIT_EXCEEDED',
        'Rate limit exceeded: Maximum 10 chat requests per minute per user account. Please slow down.',
        429,
        req
      );
    }

    const body = await req.json();
    const parsed = chatSchema.safeParse(body);
    if (!parsed.success) {
      return createErrorResponse('VALIDATION_ERROR', 'Invalid message payload', 400, req, parsed.error.issues);
    }

    const supabase = getRequestSupabase(auth.user);
    // Operator/dev identities have no auth.users row, so their turns are not persisted
    const persist = !auth.user.isServiceRole;
    const userId = auth.user.id;

    let sessionId = parsed.data.session_id;

    if (sessionId && persist) {
      // RLS on chat_messages checks user_id only, so verify the session itself belongs to the caller
      const { data: owned, error: ownErr } = await supabase
        .from('chat_sessions')
        .select('id')
        .eq('id', sessionId)
        .eq('user_id', userId)
        .maybeSingle();
      if (ownErr) {
        return createErrorResponse('DATABASE_ERROR', ownErr.message, 500, req);
      }
      if (!owned) {
        return createErrorResponse('NOT_FOUND', 'Chat session not found', 404, req);
      }
    }

    // 1. Ensure a chat session exists
    if (!sessionId && persist) {
      const { data: newSession, error: sErr } = await supabase
        .from('chat_sessions')
        .insert({
          user_id: userId,
          title: parsed.data.message.slice(0, 40) + '...'
        })
        .select('id')
        .single();
      if (sErr) {
        return createErrorResponse('DATABASE_ERROR', sErr.message, 500, req);
      }
      sessionId = newSession.id;
    }

    // 2. Load the 10 most recent messages (newest first, then restored to chronological order)
    const messageHistory: ChatMessage[] = [];
    if (sessionId && persist) {
      const { data: pastMessages, error: histErr } = await supabase
        .from('chat_messages')
        .select('role, content')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (histErr) {
        return createErrorResponse('DATABASE_ERROR', histErr.message, 500, req);
      }
      for (const m of (pastMessages || []).reverse()) {
        messageHistory.push({ role: m.role as ChatMessage['role'], content: m.content });
      }
    }

    messageHistory.push({ role: 'user', content: parsed.data.message });

    // 3. Persist user message
    if (sessionId && persist) {
      const { error: umErr } = await supabase.from('chat_messages').insert({
        session_id: sessionId,
        user_id: userId,
        role: 'user',
        content: parsed.data.message
      });
      if (umErr) {
        return createErrorResponse('DATABASE_ERROR', umErr.message, 500, req);
      }
    }

    // 4. Run Copilot inference turn; tools run with the caller's own RLS-scoped client
    const result = await runCopilotTurn(messageHistory, { userId, supabase });

    // 5. Persist assistant message, bump the session, audit
    if (sessionId && persist) {
      const writes = await Promise.all([
        supabase.from('chat_messages').insert({
          session_id: sessionId,
          user_id: userId,
          role: 'assistant',
          content: result.text,
          tool_calls: result.executedTools.length > 0 ? result.executedTools : null
        }),
        supabase.from('chat_sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId),
        supabase.from('user_activity').insert({
          user_id: userId,
          event_type: 'chat_message',
          title: 'Consulted AI Research Copilot',
          description: parsed.data.message.slice(0, 100),
          metadata: {
            session_id: sessionId,
            tools_called: result.executedTools.map((t) => t.name)
          }
        })
      ]);
      for (const { error } of writes) {
        if (error) console.error('Copilot persistence write failed:', error.message);
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

    const supabase = getRequestSupabase(auth.user);

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
