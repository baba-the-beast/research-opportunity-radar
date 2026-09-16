/**
 * IN-MEMORY RATE LIMITER & IP SANITIZATION
 * 
 * Scope & Limitations:
 * - Single-instance deployments (e.g. single Docker container or standalone Node.js server):
 *   Fully effective at throttling abusive request bursts per IP/route.
 * - Multi-instance / Horizontal Scaling / Serverless (e.g. Vercel, AWS Lambda, Kubernetes):
 *   Memory is not shared across processes or lambdas. Each instance maintains its own isolated
 *   state. For horizontal clustering, replace `rateLimitMap` with Redis or Upstash.
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
    };
  }

  // Limit exceeded
  const retryAfterSeconds = Math.max(1, Math.ceil((record.resetTime - now) / 1000));
  return {
    allowed: false,
    limit,
    remaining: 0,
    resetTime: record.resetTime,
    retryAfterSeconds,
  };
}
