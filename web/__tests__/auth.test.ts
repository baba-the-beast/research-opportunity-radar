import { describe, it, expect, afterEach } from 'vitest';
import { authenticateRequest, extractAuthToken, timingSafeEqual } from '../lib/auth';
import { getClientIp } from '../lib/rateLimit';
import { getActivePipelineLock } from '../lib/pipelineLock';

describe('Auth & IP Resolution System', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('getClientIp', () => {
    it('prefers CF-Connecting-IP over other headers', () => {
      const req = new Request('http://localhost/api/test', {
        headers: {
          'cf-connecting-ip': '203.0.113.195',
          'x-forwarded-for': '198.51.100.10, 10.0.0.1'
        }
      });
      expect(getClientIp(req)).toBe('203.0.113.195');
    });

    it('sanitizes and selects the first valid client IP from X-Forwarded-For', () => {
      const req = new Request('http://localhost/api/test', {
        headers: {
          'x-forwarded-for': '198.51.100.10, 10.0.0.1'
        }
      });
      expect(getClientIp(req)).toBe('198.51.100.10');
    });

    it('discards invalid/spoofed characters and falls back to 127.0.0.1', () => {
      const req = new Request('http://localhost/api/test', {
        headers: {
          'x-forwarded-for': '<script>alert(1)</script>'
        }
      });
      expect(getClientIp(req)).toBe('127.0.0.1');
    });
  });

  describe('timingSafeEqual', () => {
    it('returns true for matching strings and false for non-matching', () => {
      expect(timingSafeEqual('super-secret-123', 'super-secret-123')).toBe(true);
      expect(timingSafeEqual('super-secret-123', 'super-secret-456')).toBe(false);
      expect(timingSafeEqual('short', 'longer-string')).toBe(false);
    });
  });

  describe('authenticateRequest', () => {
    it('permits dev fallback when no Supabase and no secret configured', async () => {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_ANON_KEY;
      delete process.env.RADAR_API_SECRET;
      (process.env as Record<string, string>).NODE_ENV = 'development';

      const req = new Request('http://localhost/api/opportunities');
      const auth = await authenticateRequest(req);
      expect(auth.authenticated).toBe(true);
      expect(auth.user?.role).toBe('operator');
    });

    it('rejects unauthenticated requests in production when secret is set', async () => {
      (process.env as Record<string, string>).NODE_ENV = 'production';
      process.env.RADAR_API_SECRET = 'prod-secret-999';

      const req = new Request('http://localhost/api/opportunities');
      const auth = await authenticateRequest(req);
      expect(auth.authenticated).toBe(false);
      expect(auth.errorResponse?.status).toBe(401);
    });

    it('authenticates with valid operator secret and grants operator role', async () => {
      process.env.RADAR_API_SECRET = 'prod-secret-999';

      const req = new Request('http://localhost/api/pipeline/trigger', {
        headers: {
          'x-radar-secret': 'prod-secret-999'
        }
      });
      const auth = await authenticateRequest(req);
      expect(auth.authenticated).toBe(true);
      expect(auth.user?.role).toBe('operator');
    });
  });

  describe('extractAuthToken', () => {
    const session = (token: string) =>
      'base64-' + Buffer.from(JSON.stringify({ access_token: token })).toString('base64');

    it('ignores the PKCE code-verifier cookie that precedes the session cookie', () => {
      const req = new Request('http://localhost/api/profile', {
        headers: {
          cookie: `sb-abc-auth-token-code-verifier=verifier123; sb-abc-auth-token=${session('jwt-1')}`
        }
      });
      expect(extractAuthToken(req).token).toBe('jwt-1');
    });

    it('reassembles a chunked session cookie', () => {
      const value = session('jwt-chunked');
      const req = new Request('http://localhost/api/profile', {
        headers: {
          cookie: `sb-abc-auth-token-code-verifier=v; sb-abc-auth-token.0=${value.slice(0, 20)}; sb-abc-auth-token.1=${value.slice(20)}`
        }
      });
      expect(extractAuthToken(req).token).toBe('jwt-chunked');
    });
  });

  describe('Pipeline lock visibility', () => {
    it('reports no active run when Supabase is not configured', async () => {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_ANON_KEY;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      expect(await getActivePipelineLock()).toBeNull();
    });
  });
});
