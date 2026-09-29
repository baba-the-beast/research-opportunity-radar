import { describe, it, expect, afterEach } from 'vitest';
import { checkRateLimit } from '../lib/rateLimit';

describe('Security: Rate Limiter & API Auth', () => {
  const originalSecret = process.env.RADAR_API_SECRET;

  afterEach(() => {
    process.env.RADAR_API_SECRET = originalSecret;
  });

  it('rate limiter permits requests under the configured threshold', () => {
    const key = `test_key_${Date.now()}`;
    const res1 = checkRateLimit(key, 3, 60000);
    expect(res1.allowed).toBe(true);
    expect(res1.remaining).toBe(2);

    const res2 = checkRateLimit(key, 3, 60000);
    expect(res2.allowed).toBe(true);
    expect(res2.remaining).toBe(1);

    const res3 = checkRateLimit(key, 3, 60000);
    expect(res3.allowed).toBe(true);
    expect(res3.remaining).toBe(0);

    // 4th request exceeds limit of 3
    const res4 = checkRateLimit(key, 3, 60000);
    expect(res4.allowed).toBe(false);
    expect(res4.remaining).toBe(0);
    expect(res4.retryAfterSeconds).toBeGreaterThan(0);
  });
});
