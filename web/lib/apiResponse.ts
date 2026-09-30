import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

/**
 * Extracts or generates a standard unique request ID for request correlation.
 */
export function getRequestId(req?: Request | NextRequest): string {
  if (!req) return crypto.randomUUID();
  const existing = req.headers.get('x-request-id') || req.headers.get('x-correlation-id');
  if (existing && /^[a-zA-Z0-9_\-\.]{1,128}$/.test(existing)) {
    return existing;
  }
  return crypto.randomUUID();
}

/**
 * Strips sensitive patterns (tokens, keys, passwords, file paths) from error messages.
 */
function sanitizeErrorMessage(msg: string): string {
  if (!msg) return 'An unexpected error occurred.';
  return msg
    .replace(/(eyJh[a-zA-Z0-9_\-\.]{10,})/g, '[REDACTED_JWT]')
    .replace(/([a-zA-Z0-9_-]{24,})/g, '[REDACTED_SECRET]')
    .replace(/(postgres:\/\/|postgresql:\/\/)[^\s]+/gi, '[REDACTED_DATABASE_URI]')
    .replace(/[A-Z]:\\[^\s]+/g, '[REDACTED_PATH]')
    .replace(/\/app\/[^\s]+/g, '[REDACTED_PATH]');
}

/**
 * Formats standard error response with request correlation and error code.
 */
export function createErrorResponse(
  code: string,
  message: string,
  status: number,
  req?: Request | NextRequest,
  internalContext?: any
): NextResponse {
  const requestId = getRequestId(req);

  // Structured server-side logging for observability
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      requestId,
      code,
      status,
      message,
      context: internalContext ? String(internalContext) : undefined
    })
  );

  // Server-side failures (database errors, exceptions) can name tables, columns or hosts: in
  // production callers get a reference id instead; the details are in the log line above.
  const hideDetails = status >= 500 && process.env.NODE_ENV === 'production';
  return NextResponse.json(
    {
      error: {
        code,
        message: hideDetails
          ? `Something went wrong on our side. Please try again; if it keeps happening, quote reference ${requestId}.`
          : sanitizeErrorMessage(message),
        requestId
      }
    },
    {
      status,
      headers: {
        'x-request-id': requestId
      }
    }
  );
}

/**
 * Formats standard success response with request ID header.
 */
export function createSuccessResponse<T>(
  data: T,
  req?: Request | NextRequest,
  status: number = 200,
  extraHeaders?: Record<string, string>
): NextResponse {
  const requestId = getRequestId(req);
  return NextResponse.json(data, {
    status,
    headers: {
      'x-request-id': requestId,
      ...(extraHeaders || {})
    }
  });
}
