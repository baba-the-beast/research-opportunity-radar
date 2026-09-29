import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Minimal chainable fake of the Supabase admin client: records writes, serves link codes
type Row = Record<string, any>;
const db: { codes: Row[]; prefs: Row[]; activity: Row[] } = { codes: [], prefs: [], activity: [] };

function table(name: 'telegram_link_codes' | 'user_preferences' | 'user_activity') {
  const rows = () => (name === 'telegram_link_codes' ? db.codes : name === 'user_preferences' ? db.prefs : db.activity);
  const filters: Array<(r: Row) => boolean> = [];
  let mutation: { kind: 'update' | 'delete'; data?: Row } | null = null;
  const run = () => {
    const matched = rows().filter((r) => filters.every((f) => f(r)));
    if (mutation?.kind === 'update') matched.forEach((r) => Object.assign(r, mutation!.data));
    if (mutation?.kind === 'delete') {
      const keep = rows().filter((r) => !matched.includes(r));
      rows().splice(0, rows().length, ...keep);
    }
    return { data: matched, error: null };
  };
  const q: any = {
    select: () => q,
    eq: (c: string, v: any) => (filters.push((r) => r[c] === v), q),
    neq: (c: string, v: any) => (filters.push((r) => r[c] !== v), q),
    update: (data: Row) => ((mutation = { kind: 'update', data }), q),
    delete: () => ((mutation = { kind: 'delete' }), q),
    maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
    insert: async (row: Row) => (rows().push(row), { error: null }),
    upsert: async (row: Row) => {
      const existing = rows().find((r) => r.user_id === row.user_id);
      existing ? Object.assign(existing, row) : rows().push(row);
      return { error: null };
    },
    then: (resolve: any) => resolve(run())
  };
  return q;
}

vi.mock('@/lib/supabaseServerClient', () => ({
  getSupabaseAdminClient: () => ({ from: table })
}));

import { POST } from '@/app/api/telegram/webhook/route';

const SECRET = 'webhook-secret-0123456789';
const USER = '11111111-2222-4333-8444-555555555555';

function update(text: string, chatType = 'private', chatId = 777) {
  return new NextRequest('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': SECRET, 'content-type': 'application/json' },
    body: JSON.stringify({ message: { text, chat: { id: chatId, type: chatType }, from: { first_name: 'Ada' } } })
  });
}

describe('POST /api/telegram/webhook', () => {
  const originalEnv = { ...process.env };
  let replies: Array<{ chat_id: string; text: string }>;

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = '123:fake';
    process.env.TELEGRAM_BOT_USERNAME = 'RadarBot';
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    db.codes = [];
    db.prefs = [];
    db.activity = [];
    replies = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        replies.push(JSON.parse(String(init.body)));
        return new Response('{"ok":true}', { status: 200 });
      })
    );
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it('rejects requests without the webhook secret', async () => {
    const req = new NextRequest('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'wrong' },
      body: '{}'
    });
    expect((await POST(req)).status).toBe(401);
    expect(replies).toHaveLength(0);
  });

  it('/start <code> links the private chat to the code owner and consumes the code', async () => {
    db.codes.push({ code: 'abc', user_id: USER, expires_at: new Date(Date.now() + 60_000).toISOString() });

    const res = await POST(update('/start abc'));

    expect(res.status).toBe(200);
    expect(db.prefs).toEqual([expect.objectContaining({ user_id: USER, telegram_chat_id: '777', telegram_alerts: true })]);
    expect(db.codes).toHaveLength(0); // one-time
    expect(replies[0]).toMatchObject({ chat_id: '777' });
    expect(replies[0].text).toContain('Connected');

    // Replaying the same update cannot re-bind anything
    await POST(update('/start abc'));
    expect(replies[1].text).toContain('expired or was already used');
  });

  it('refuses expired codes', async () => {
    db.codes.push({ code: 'old', user_id: USER, expires_at: new Date(Date.now() - 1000).toISOString() });
    await POST(update('/start old'));
    expect(db.prefs).toHaveLength(0);
    expect(replies[0].text).toContain('expired');
  });

  it('ignores group chats (alerts are personal)', async () => {
    db.codes.push({ code: 'abc', user_id: USER, expires_at: new Date(Date.now() + 60_000).toISOString() });
    const res = await POST(update('/start abc', 'group'));
    expect(res.status).toBe(200);
    expect(db.prefs).toHaveLength(0);
    expect(replies).toHaveLength(0);
  });

  it('moves a chat to the new account when it was linked elsewhere', async () => {
    const OTHER = '99999999-2222-4333-8444-555555555555';
    db.prefs.push({ user_id: OTHER, telegram_chat_id: '777', telegram_alerts: true });
    db.codes.push({ code: 'abc', user_id: USER, expires_at: new Date(Date.now() + 60_000).toISOString() });

    await POST(update('/start abc'));

    expect(db.prefs.find((p) => p.user_id === OTHER)).toMatchObject({ telegram_chat_id: null, telegram_alerts: false });
    expect(db.prefs.find((p) => p.user_id === USER)).toMatchObject({ telegram_chat_id: '777' });
  });

  it('/stop turns alerts off for that chat', async () => {
    db.prefs.push({ user_id: USER, telegram_chat_id: '777', telegram_alerts: true });
    await POST(update('/stop'));
    expect(db.prefs[0]).toMatchObject({ telegram_chat_id: null, telegram_alerts: false });
    expect(replies[0].text).toContain('stopped');
  });

  it('returns 503 when Telegram is not configured', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    expect((await POST(update('/start abc'))).status).toBe(503);
  });
});
