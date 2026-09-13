import { describe, it, expect, afterEach } from 'vitest';
import { checkRateLimit } from '../lib/rateLimit';
import { validateApiAuth } from '../lib/apiAuth';

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

  it('validateApiAuth permits all requests when RADAR_API_SECRET is unset', () => {
    delete process.env.RADAR_API_SECRET;
    const req = new Request('http://localhost/api/profile', { method: 'POST' });
    const auth = validateApiAuth(req);
    expect(auth.authorized).toBe(true);
  });

  it('validateApiAuth blocks requests when secret is set and header is missing', () => {
    process.env.RADAR_API_SECRET = 'secret_radar_token_123';
    const req = new Request('http://localhost/api/profile', { method: 'POST' });
    const auth = validateApiAuth(req);
    expect(auth.authorized).toBe(false);
    expect(auth.response?.status).toBe(401);
  });

  it('validateApiAuth permits requests when valid Bearer token is provided', () => {
    process.env.RADAR_API_SECRET = 'secret_radar_token_123';
    const req = new Request('http://localhost/api/profile', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret_radar_token_123' },
    });
    const auth = validateApiAuth(req);
    expect(auth.authorized).toBe(true);
  });

  it('validateApiAuth permits requests when valid x-radar-secret is provided', () => {
    process.env.RADAR_API_SECRET = 'secret_radar_token_123';
    const req = new Request('http://localhost/api/profile', {
      method: 'POST',
      headers: { 'x-radar-secret': 'secret_radar_token_123' },
    });
    const auth = validateApiAuth(req);
    expect(auth.authorized).toBe(true);
  });
});
