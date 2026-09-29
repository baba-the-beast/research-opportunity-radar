import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkRateLimit, consumeRateLimit, resetRateLimits } from '../lib/rateLimit';

describe('Copilot Chat Dual-Key Rate Limiting Tests', () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it('enforces per-user chat quota (10 req/min) and blocks 11th request', () => {
    const userKey = 'chat_usr_user-12345';
    const limit = 10;
    const windowMs = 60000;

    // First 10 requests must succeed
    for (let i = 1; i <= limit; i++) {
      const check = checkRateLimit(userKey, limit, windowMs);
      expect(check.allowed).toBe(true);
      expect(check.remaining).toBe(limit - i);
    }

    // 11th request must be rejected with 429 semantics
    const excess = checkRateLimit(userKey, limit, windowMs);
    expect(excess.allowed).toBe(false);
    expect(excess.remaining).toBe(0);
    expect(excess.retryAfterMs).toBeGreaterThan(0);
  });

  it('isolates user quotas so one heavy user does not exhaust another user', () => {
    const userA = 'chat_usr_faculty_dr_sharma';
    const userB = 'chat_usr_faculty_dr_verma';
    const limit = 10;
    const windowMs = 60000;

    // User A exhausts their quota
    for (let i = 0; i < limit; i++) {
      checkRateLimit(userA, limit, windowMs);
    }
    expect(checkRateLimit(userA, limit, windowMs).allowed).toBe(false);

    // User B should still have full quota intact
    const checkB = checkRateLimit(userB, limit, windowMs);
    expect(checkB.allowed).toBe(true);
    expect(checkB.remaining).toBe(9);
  });

  it('enforces per-IP quota (25 req/min) and accommodates multiple campus users until global cap', () => {
    const campusIp = 'chat_ip_14.139.123.45'; // ERNET / Indian academic IP range
    const limit = 25;
    const windowMs = 60000;

    for (let i = 1; i <= limit; i++) {
      const check = checkRateLimit(campusIp, limit, windowMs);
      expect(check.allowed).toBe(true);
      expect(check.remaining).toBe(limit - i);
    }

    const excess = checkRateLimit(campusIp, limit, windowMs);
    expect(excess.allowed).toBe(false);
    expect(excess.remaining).toBe(0);
  });
});

describe('consumeRateLimit shared backend', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    resetRateLimits();
  });

  it('uses Upstash counts when configured', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ result: 11 }, { result: 0 }, { result: 42_000 }]), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await consumeRateLimit('chat_usr_x', 10, 60_000);

    expect(res.allowed).toBe(false);
    expect(res.retryAfterSeconds).toBe(42);
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.upstash.io/pipeline');
  });

  it('falls back to the in-memory limiter when Redis is unreachable', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await consumeRateLimit('chat_usr_y', 2, 60_000);

    expect(res.allowed).toBe(true);
    expect(res.remaining).toBe(1);
  });
});
