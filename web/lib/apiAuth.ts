import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

/**
 * Constant-time equality comparison using crypto.timingSafeEqual on SHA-256 digests.
 * Hashing fixed 32-byte buffers ensures identical length comparison, eliminating timing attack surface
 * and length leakage on secret tokens.
 */
function timingSafeMatch(provided: string, expected: string): boolean {
  if (!provided || !expected) {
    return false;
  }
  const hashProvided = crypto.createHash('sha256').update(provided).digest();
  const hashExpected = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(hashProvided, hashExpected);
}

/**
 * Validates request authorization against RADAR_API_SECRET if configured.
 * If RADAR_API_SECRET is not set, requests are permitted (single-user intranet model).
 */
export function validateApiAuth(req: Request | NextRequest): { authorized: boolean; response?: NextResponse } {
  const secret = process.env.RADAR_API_SECRET;
  if (!secret || secret.trim() === '') {
    // Single-user / local trusted deployment mode
    return { authorized: true };
  }

  const authHeader = req.headers.get('authorization') || '';
  const customSecret = req.headers.get('x-radar-secret') || '';

  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (timingSafeMatch(bearerToken, secret) || timingSafeMatch(customSecret, secret)) {
    return { authorized: true };
  }

  return {
    authorized: false,
    response: NextResponse.json(
      {
        error: 'Unauthorized: Missing or invalid API authentication token.',
        remediation: 'Provide valid Bearer token or x-radar-secret header matching RADAR_API_SECRET.'
      },
      { status: 401 }
    ),
  };
}
