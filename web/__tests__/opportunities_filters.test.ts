import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const USER_ID = '11111111-2222-4333-8444-555555555555';

vi.mock('@/lib/auth', () => ({
  authenticateRequest: vi.fn(async () => ({
    authenticated: true,
    user: { id: USER_ID, role: 'faculty', isServiceRole: false, token: 'jwt' }
  }))
}));

// Real supabase-js query builder (so we see the exact PostgREST URL), with fetch stubbed
vi.mock('@/lib/routeContext', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getRequestSupabase: () => createClient('https://project.supabase.co', 'anon-key'),
    getOwnProfileId: async () => null
  };
});

import { GET } from '@/app/api/opportunities/route';

describe('GET /api/opportunities saved/status filters', () => {
  let requested: URL[];

  beforeEach(() => {
    requested = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requested.push(new URL(typeof input === 'string' ? input : input.toString()));
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
      })
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  const call = (qs: string) => GET(new NextRequest(`http://localhost/api/opportunities?${qs}`));
  const oppRequests = () => requested.filter((u) => u.pathname.endsWith('/opportunities'));

  it('status=new is a single anti-join query, never an id list', async () => {
    const res = await call('status=new');
    expect(res.status).toBe(200);

    const [url] = oppRequests();
    const params = url.searchParams;
    expect(params.get('select')).toContain('user_opportunity_state!left');
    expect(params.get('user_opportunity_state')).toBe('is.null');
    expect(params.get('user_opportunity_state.user_id')).toBe(`eq.${USER_ID}`);
    expect(params.get('user_opportunity_state.status')).toBe('neq.new');
    expect(params.get('id')).toBeNull();
    // No separate pre-query that fetched the user's whole state history
    expect(requested.filter((u) => u.pathname.endsWith('/user_opportunity_state'))).toHaveLength(0);
  });

  it('saved=true uses an inner join filtered to the caller', async () => {
    await call('saved=true');
    const params = oppRequests()[0].searchParams;
    expect(params.get('select')).toContain('user_opportunity_state!inner');
    expect(params.get('user_opportunity_state.user_id')).toBe(`eq.${USER_ID}`);
    expect(params.get('user_opportunity_state.saved')).toBe('eq.true');
    expect(params.get('id')).toBeNull();
  });

  it('status=pursuing uses an inner join on that status', async () => {
    await call('status=pursuing');
    const params = oppRequests()[0].searchParams;
    expect(params.get('select')).toContain('user_opportunity_state!inner');
    expect(params.get('user_opportunity_state.status')).toBe('eq.pursuing');
  });

  it('no filter adds no state join', async () => {
    await call('');
    expect(oppRequests()[0].searchParams.get('select')).not.toContain('user_opportunity_state');
  });
});
