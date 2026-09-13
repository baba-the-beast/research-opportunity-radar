/**
 * IN-MEMORY RATE LIMITER - ARCHITECTURAL NOTICE:
 * This rate limiter stores request counts in a process-local memory Map (`rateLimitMap`).
 * 
 * Scope & Limitations:
 * - Single-instance deployments (e.g. single Docker container or standalone Node.js server):
 *   Fully effective at throttling abusive request bursts per IP/route.
 * - Multi-instance / Horizontal Scaling / Serverless (e.g. Vercel, AWS Lambda, Kubernetes):
 *   Memory is not shared across processes or lambdas. Each instance maintains its own isolated
 *   state, allowing up to (limit * num_instances) requests.
 * 
 * Production Scaling Recommendation:
 * Before scaling horizontally or moving to serverless deployment, replace `rateLimitMap`
 * with a shared distributed store such as Redis (e.g. @upstash/ratelimit or ioredis).
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
