/**
 * RATE LIMITING & IP SANITIZATION
 *
 * - consumeRateLimit(): what route handlers call. Uses Upstash Redis (shared across instances and
 *   restarts) when UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are set, else the in-memory map.
 * - checkRateLimit(): the in-memory limiter. Per process only: it resets on every deploy/restart and
 *   is not shared between instances, so production should configure the Redis backend.
 */

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitRecord>();

/**
 * Clean up expired rate limit entries periodically.
 */
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitMap.entries()) {
      if (now > record.resetTime) {
        rateLimitMap.delete(key);
      }
    }
  }, 60000);
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
  retryAfterSeconds: number;
  retryAfterMs: number;
}

/**
 * Safely extracts and sanitizes client IP address to prevent header spoofing and injection.
 */
export function getClientIp(req: Request): string {
  // 1. Cloudflare connecting IP (verified by CF edge)
  const cfIp = req.headers.get('cf-connecting-ip');
  if (cfIp && isValidIp(cfIp.trim())) {
    return cfIp.trim();
  }

  // 2. Standard single-proxy real IP
  const realIp = req.headers.get('x-real-ip');
  if (realIp && isValidIp(realIp.trim())) {
    return realIp.trim();
  }

  // 3. X-Forwarded-For (extract leftmost untrusted entry, strictly validated)
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',').map((p) => p.trim());
    for (const part of parts) {
      if (isValidIp(part)) {
        return part;
      }
    }
  }

  return '127.0.0.1';
}

function isValidIp(ip: string): boolean {
  // Simple IPv4 and IPv6 format validator
  const ipv4Pattern = /^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
  const ipv6Pattern = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::$|^::1$/;
  return ipv4Pattern.test(ip) || ipv6Pattern.test(ip);
}

/**
 * Checks if a given key (e.g. IP address or route name) has exceeded the rate limit.
 * @param key Unique identifier for the rate limit bucket
 * @param limit Maximum allowed requests in the window
 * @param windowMs Time window in milliseconds
 */
export function checkRateLimit(key: string, limit: number = 5, windowMs: number = 600000): RateLimitResult {
  const now = Date.now();
  const record = rateLimitMap.get(key);

  if (!record || now > record.resetTime) {
    // New window
    rateLimitMap.set(key, { count: 1, resetTime: now + windowMs });
    return {
      allowed: true,
      limit,
      remaining: limit - 1,
      resetTime: now + windowMs,
      retryAfterSeconds: 0,
      retryAfterMs: 0,
    };
  }

  if (record.count < limit) {
    record.count += 1;
    return {
      allowed: true,
      limit,
      remaining: limit - record.count,
      resetTime: record.resetTime,
      retryAfterSeconds: 0,
      retryAfterMs: 0,
    };
  }

  // Limit exceeded
  const retryAfterMs = Math.max(1, record.resetTime - now);
  return {
    allowed: false,
    limit,
    remaining: 0,
    resetTime: record.resetTime,
    retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    retryAfterMs,
  };
}

/** Clears all buckets. Test-only; state is per process, so this never affects other instances. */
export function resetRateLimits(): void {
  rateLimitMap.clear();
}

// ─── Shared (multi-instance) backend ──────────────────────────────────────────

const REDIS_TIMEOUT_MS = 1500;

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

/**
 * Fixed-window counter in Upstash Redis (REST API, so no client dependency). One pipelined round
 * trip: INCR, set the window TTL only on the first hit, then read the remaining TTL.
 */
async function consumeRedis(
  cfg: { url: string; token: string },
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const redisKey = `ratelimit:${key}`;
  const res = await fetch(`${cfg.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      ['INCR', redisKey],
      ['PEXPIRE', redisKey, String(windowMs), 'NX'],
      ['PTTL', redisKey]
    ]),
    signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
    cache: 'no-store'
  });
  if (!res.ok) {
    throw new Error(`Upstash returned ${res.status}`);
  }
  const [incr, , pttl] = (await res.json()) as Array<{ result?: number; error?: string }>;
  if (incr?.error || typeof incr?.result !== 'number') {
    throw new Error(incr?.error || 'unexpected Upstash response');
  }
  const count = incr.result;
  const ttlMs = typeof pttl?.result === 'number' && pttl.result > 0 ? pttl.result : windowMs;
  const resetTime = Date.now() + ttlMs;
  const allowed = count <= limit;
  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - count),
    resetTime,
    retryAfterSeconds: allowed ? 0 : Math.ceil(ttlMs / 1000),
    retryAfterMs: allowed ? 0 : ttlMs
  };
}

/**
 * Rate limit shared across instances and restarts when UPSTASH_REDIS_REST_URL/TOKEN are set;
 * otherwise (or if Redis is unreachable) falls back to this process's in-memory limiter, so an
 * outage degrades to per-instance limits rather than blocking or unthrottling every request.
 */
export async function consumeRateLimit(
  key: string,
  limit: number = 5,
  windowMs: number = 600000
): Promise<RateLimitResult> {
  const cfg = redisConfig();
  if (cfg) {
    try {
      return await consumeRedis(cfg, key, limit, windowMs);
    } catch (err: any) {
      console.error(`[rateLimit] shared backend unavailable, using in-memory limiter: ${err.message}`);
    }
  }
  return checkRateLimit(key, limit, windowMs);
}
