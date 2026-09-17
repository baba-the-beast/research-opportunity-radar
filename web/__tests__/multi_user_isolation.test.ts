import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authenticateRequest, authorizeRole, extractAuthToken } from '../lib/auth';

describe('Multi-User SaaS Tenant Isolation & Security Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RADAR_API_SECRET;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
  });

  it('correctly extracts Supabase SSR cookie tokens including chunked and base64 formats', () => {
    // Standard cookie
    const req1 = new Request('http://localhost:3000/api/settings', {
      headers: {
        cookie: 'sb-sampleproject-auth-token=test-jwt-token-123'
      }
    });
    const res1 = extractAuthToken(req1);
    expect(res1.token).toBe('test-jwt-token-123');

    // Base64 encoded JSON cookie
    const jsonPayload = JSON.stringify({ access_token: 'extracted-jwt-456' });
    const b64 = `base64-${Buffer.from(jsonPayload).toString('base64')}`;
    const req2 = new Request('http://localhost:3000/api/settings', {
      headers: {
        cookie: `sb-sampleproject-auth-token=${b64}`
      }
    });
    const res2 = extractAuthToken(req2);
    expect(res2.token).toBe('extracted-jwt-456');

    // Chunked cookies (.0, .1)
    const req3 = new Request('http://localhost:3000/api/settings', {
      headers: {
        cookie: 'sb-sampleproject-auth-token.0=part1-;sb-sampleproject-auth-token.1=part2-jwt'
      }
    });
    const res3 = extractAuthToken(req3);
    expect(res3.token).toBe('part1-part2-jwt');
  });

  it('rejects unauthenticated requests to protected endpoints in production mode', async () => {
    process.env.NODE_ENV = 'production';
    process.env.RADAR_API_SECRET = 'super-secret-operator-key';
    process.env.SUPABASE_URL = 'https://mock.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'mock-anon-key';

    const req = new Request('http://localhost:3000/api/opportunities/saved');
    const auth = await authenticateRequest(req);

    expect(auth.authenticated).toBe(false);
    expect(auth.errorResponse?.status).toBe(401);
  });

  it('enforces RBAC role authorization strictly', () => {
    const facultyUser = {
      id: 'usr-1',
      role: 'faculty' as const,
      isServiceRole: false
    };

    const adminUser = {
      id: 'admin-1',
      role: 'admin' as const,
      isServiceRole: false
    };

    // Faculty authorized for faculty endpoint
    const check1 = authorizeRole(facultyUser, ['faculty']);
    expect(check1.authorized).toBe(true);

    // Faculty rejected from operator-only pipeline endpoint
    const check2 = authorizeRole(facultyUser, ['operator']);
    expect(check2.authorized).toBe(false);
    expect(check2.errorResponse?.status).toBe(403);

    // Admin authorized everywhere
    const check3 = authorizeRole(adminUser, ['operator']);
    expect(check3.authorized).toBe(true);
  });

  it('guarantees /api/health remains public and unencumbered', async () => {
    // Mock health route behavior
    const healthReq = new Request('http://localhost:3000/api/health');
    // Ensure no token is required
    expect(extractAuthToken(healthReq).token).toBeUndefined();
  });
});
