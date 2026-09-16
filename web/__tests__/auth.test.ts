import { describe, it, expect, afterEach } from 'vitest';
import { authenticateRequest, timingSafeEqual } from '../lib/auth';
import { getClientIp } from '../lib/rateLimit';
import { acquirePipelineLock, releasePipelineLock } from '../lib/pipelineLock';

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
      process.env.NODE_ENV = 'development';

      const req = new Request('http://localhost/api/opportunities');
      const auth = await authenticateRequest(req);
      expect(auth.authenticated).toBe(true);
      expect(auth.user?.role).toBe('operator');
    });

    it('rejects unauthenticated requests in production when secret is set', async () => {
      process.env.NODE_ENV = 'production';
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
      const auth = await authenticateRequest(req, { requiredRole: 'operator' });
      expect(auth.authenticated).toBe(true);
      expect(auth.user?.role).toBe('operator');
    });
  });

  describe('Distributed Pipeline Lock Manager', () => {
    it('acquires and releases lock cleanly', async () => {
      const lockKey = `test-lock-${Date.now()}`;
      const workerA = 'worker-A';
      const workerB = 'worker-B';

      const acquiredA = await acquirePipelineLock(lockKey, workerA, 30);
      expect(acquiredA.acquired).toBe(true);

      // Concurrent request by worker B should be rejected
      const acquiredB = await acquirePipelineLock(lockKey, workerB, 30);
      expect(acquiredB.acquired).toBe(false);

      // Worker A releases
      const released = await releasePipelineLock(lockKey, workerA);
      expect(released).toBe(true);

      // Now worker B can acquire
      const acquiredB2 = await acquirePipelineLock(lockKey, workerB, 30);
      expect(acquiredB2.acquired).toBe(true);

      await releasePipelineLock(lockKey, workerB);
    });
  });
});
