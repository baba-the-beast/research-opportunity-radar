import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export interface UserIdentity {
  id: string;
  email?: string;
  role: 'faculty' | 'operator' | 'admin';
  isServiceRole: boolean;
  token?: string;
}

export interface AuthResult {
  authenticated: boolean;
  user?: UserIdentity;
  errorResponse?: NextResponse;
}

/**
 * Constant-time equality comparison using crypto.timingSafeEqual on SHA-256 digests.
 * Hashing fixed 32-byte buffers ensures identical length comparison, eliminating timing attack surface.
 */
export function timingSafeMatch(provided: string, expected: string): boolean {
  if (!provided || !expected) {
    return false;
  }
  const hashProvided = crypto.createHash('sha256').update(provided).digest();
  const hashExpected = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(hashProvided, hashExpected);
}

export const timingSafeEqual = timingSafeMatch;

/**
 * Extracts Bearer token or custom secret from request headers or cookies.
 */
export function extractAuthToken(req: Request | NextRequest): { token?: string; isSecretHeader?: boolean } {
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    return { token: authHeader.slice(7).trim(), isSecretHeader: false };
  }

  const customSecret = req.headers.get('x-radar-secret');
  if (customSecret) {
    return { token: customSecret.trim(), isSecretHeader: true };
  }

  // Check cookies for Supabase session token if available
  const cookieHeader = req.headers.get('cookie') || '';
  if (cookieHeader) {
    const rawCookies = Object.fromEntries(
      cookieHeader.split(';').map((c) => {
        const [k, ...v] = c.trim().split('=');
        return [k, decodeURIComponent(v.join('='))];
      })
    );

    // 1. Direct or chunked Supabase cookie lookup
    let cookieVal = rawCookies['sb-access-token'];
    if (!cookieVal) {
      const baseKey = Object.keys(rawCookies).find((k) => k.startsWith('sb-') && k.includes('-auth-token'));
      if (baseKey) {
        if (baseKey.endsWith('.0')) {
          // Reassemble chunked cookies (.0, .1, etc.)
          const root = baseKey.slice(0, -2);
          const chunks: string[] = [];
          for (let i = 0; rawCookies[`${root}.${i}`]; i++) {
            chunks.push(rawCookies[`${root}.${i}`]);
          }
          cookieVal = chunks.join('');
        } else {
          cookieVal = rawCookies[baseKey];
        }
      }
    }

    if (cookieVal) {
      try {
        let str = cookieVal;
        if (str.startsWith('base64-')) {
          str = Buffer.from(str.slice(7), 'base64').toString('utf-8');
        }
        if (str.startsWith('{') || str.startsWith('[')) {
          const parsed = JSON.parse(str);
          if (Array.isArray(parsed) && parsed[0]) {
            return { token: parsed[0], isSecretHeader: false };
          }
          if (parsed.access_token) {
            return { token: parsed.access_token, isSecretHeader: false };
          }
        }
        return { token: cookieVal, isSecretHeader: false };
      } catch {
        return { token: cookieVal, isSecretHeader: false };
      }
    }
  }

  return {};
}

/**
 * Authenticates request against:
 * 1. Server-side RADAR_API_SECRET (grants 'operator' identity for CI/schedulers)
 * 2. Supabase Auth JWT (verifies cryptographic signature against Supabase)
 * 3. Fallback: Single-user local development mode when neither auth is configured.
 */
export async function authenticateRequest(req: Request | NextRequest): Promise<AuthResult> {
  const { token, isSecretHeader } = extractAuthToken(req);
  const operatorSecret = process.env.RADAR_API_SECRET;

  // 1. Check if token matches operator secret
  if (token && operatorSecret && timingSafeMatch(token, operatorSecret)) {
    return {
      authenticated: true,
      user: {
        id: 'system-operator',
        email: 'operator@radar.internal',
        role: 'operator',
        isServiceRole: true,
        token
      }
    };
  }

  // 2. Validate token against Supabase Auth if Supabase is configured
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (token && !isSecretHeader && supabaseUrl && anonKey) {
    try {
      const supabase = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false },
        global: {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      });

      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (!error && user) {
        const userRole = (user.app_metadata?.role || user.user_metadata?.role || 'faculty') as 'faculty' | 'operator' | 'admin';
        return {
          authenticated: true,
          user: {
            id: user.id,
            email: user.email,
            role: userRole,
            isServiceRole: false,
            token
          }
        };
      }
    } catch {
      // Supabase verification failed; continue to rejection
    }
  }

  // 3. Local single-user trusted intranet / development fallback
  // When no RADAR_API_SECRET is configured AND no Supabase URL is present, or in test environment
  const isTestOrLocalDev =
    process.env.NODE_ENV === 'test' ||
    process.env.NODE_ENV === 'development' ||
    (!process.env.RADAR_API_SECRET && process.env.ALLOW_IN_MEMORY_DB === '1') ||
    (!process.env.RADAR_API_SECRET && !process.env.SUPABASE_URL);

  if (isTestOrLocalDev && !token) {
    return {
      authenticated: true,
      user: {
        id: 'dev-local-user',
        email: 'dev@local.internal',
        role: 'operator',
        isServiceRole: true
      }
    };
  }

  return {
    authenticated: false,
    errorResponse: NextResponse.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required. Provide a valid Bearer JWT session token or x-radar-secret header.'
        }
      },
      { status: 401 }
    )
  };
}

/**
 * Enforces Role-Based Access Control (RBAC).
 */
export function authorizeRole(
  identity: UserIdentity | undefined,
  allowedRoles: Array<'faculty' | 'operator' | 'admin'>
): { authorized: boolean; errorResponse?: NextResponse } {
  if (!identity) {
    return {
      authorized: false,
      errorResponse: NextResponse.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required before role authorization.'
          }
        },
        { status: 401 }
      )
    };
  }

  if (identity.isServiceRole || identity.role === 'admin' || allowedRoles.includes(identity.role)) {
    return { authorized: true };
  }

  return {
    authorized: false,
    errorResponse: NextResponse.json(
      {
        error: {
          code: 'FORBIDDEN',
          message: `Insufficient privileges. Role '${identity.role}' cannot access this resource. Allowed: ${allowedRoles.join(', ')}`
        }
      },
      { status: 403 }
    )
  };
}
