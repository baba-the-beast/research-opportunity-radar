import { describe, expect, it } from 'vitest';
import { daysUntil, formatDeadline, istDate } from '../lib/dates';
import { getClientIp, rateLimitKey } from '../lib/rateLimit';

describe('IST dates', () => {
  it('uses the Indian calendar date, not UTC', () => {
    // 20:00 UTC on 29 Sep is 01:30 on 30 Sep in India
    expect(istDate(new Date('2026-09-29T20:00:00Z'))).toBe('2026-09-30');
    expect(istDate(new Date('2026-09-29T18:00:00Z'))).toBe('2026-09-29');
  });

  it('counts whole days to a deadline', () => {
    expect(daysUntil('2026-10-15', '2026-09-29')).toBe(16);
    expect(daysUntil('2026-09-29', '2026-09-29')).toBe(0);
    expect(daysUntil('2026-09-28', '2026-09-29')).toBe(-1);
    // Across a month and year boundary
    expect(daysUntil('2027-01-01', '2026-12-31')).toBe(1);
  });

  it('formats deadlines without shifting the day', () => {
    expect(formatDeadline('2026-10-15')).toMatch(/15 Oct 2026/);
  });
});

describe('rate limit keys', () => {
  const req = (headers: Record<string, string>) => new Request('https://radar.example/api/x', { headers });

  it('keys signed-in users by id, so spoofed IP headers do not matter', () => {
    const r = req({ 'x-forwarded-for': '1.2.3.4' });
    expect(rateLimitKey(r, { id: 'user-1' })).toBe('user:user-1');
    expect(rateLimitKey(r, null)).toBe('ip:1.2.3.4');
  });

  it('accepts compressed IPv6 addresses instead of lumping them into one bucket', () => {
    expect(getClientIp(req({ 'x-real-ip': '2001:db8::1' }))).toBe('2001:db8::1');
    expect(getClientIp(req({ 'x-real-ip': '2001:db8::1::2' }))).toBe('127.0.0.1');
    expect(getClientIp(req({ 'x-real-ip': 'not-an-ip' }))).toBe('127.0.0.1');
  });
});
