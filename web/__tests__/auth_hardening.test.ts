import { describe, it, expect, afterEach, vi } from 'vitest';

const mockGetUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: mockGetUser } })
}));

import { authenticateRequest } from '../lib/auth';
import { safeRedirectPath } from '../lib/safeRedirect';
import { getSupabaseUserClient } from '../lib/supabaseServerClient';

describe('safeRedirectPath', () => {
  it('rejects the decoded tab bypass that URL parsing turns into //evil.com', () => {
    const decoded = decodeURIComponent('/%09/evil.com');
    expect(new URL(decoded, 'https://app.test').host).toBe('evil.com'); // why the guard is needed
    expect(safeRedirectPath(decoded)).toBe('/');
  });

  it('keeps same-origin relative paths', () => {
    expect(safeRedirectPath('/deadlines')).toBe('/deadlines');
    expect(safeRedirectPath('/opportunities/abc?tab=score')).toBe('/opportunities/abc?tab=score');
  });

  it.each([
    [null],
    [''],
    ['https://evil.com'],
    ['//evil.com'],
    ['/\\evil.com'],
    ['@evil.com'],
    ['javascript:alert(1)'],
    ['/\t/evil.com'],
    ['/\n/evil.com'],
    ['/\r/evil.com'],
    ['/ /evil.com']
  ])('rejects off-site target %j', (next) => {
    expect(safeRedirectPath(next)).toBe('/');
  });
});

describe('authenticateRequest role resolution', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    mockGetUser.mockReset();
  });

  const authedRequest = () =>
    new Request('http://localhost/api/profile', { headers: { authorization: 'Bearer user-jwt' } });

  it('ignores user-writable user_metadata.role', async () => {
    process.env.SUPABASE_URL = 'https://xyz.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon';
    process.env.RADAR_API_SECRET = 'operator-secret';
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', app_metadata: {}, user_metadata: { role: 'admin' } } },
      error: null
    });

    const auth = await authenticateRequest(authedRequest());
    expect(auth.user?.role).toBe('faculty');
  });

  it('honours server-controlled app_metadata.role', async () => {
    process.env.SUPABASE_URL = 'https://xyz.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon';
    process.env.RADAR_API_SECRET = 'operator-secret';
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', app_metadata: { role: 'operator' }, user_metadata: {} } },
      error: null
    });

    const auth = await authenticateRequest(authedRequest());
    expect(auth.user?.role).toBe('operator');
  });
});

describe('getSupabaseUserClient', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('refuses to build an RLS-bypassing client from the service key without a user token', () => {
    process.env.SUPABASE_URL = 'https://xyz.supabase.co';
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';

    expect(() => getSupabaseUserClient()).toThrow(/SUPABASE_ANON_KEY/);
    expect(() => getSupabaseUserClient('user-jwt')).not.toThrow();
  });
});
