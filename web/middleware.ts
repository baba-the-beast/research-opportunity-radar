import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { safeRedirectPath } from '@/lib/safeRedirect';

// The dashboard ('/') is deliberately not public: every visitor signs in first.
const PUBLIC_EXACT_PATHS = new Set([
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/api/auth/callback',
  '/api/health',
  '/api/health/live',
  '/api/health/ready',
  // Lets the config banner explain a misconfigured deployment before anyone can sign in
  '/api/config/status'
]);

/** Constant-time string comparison (Edge runtime has no crypto.timingSafeEqual). */
function secretsMatch(provided: string, expected: string): boolean {
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) {
    diff |= (a[i % (a.length || 1)] ?? 0) ^ b[i];
  }
  return diff === 0;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. Skip internal paths and favicon. Static files are already excluded by `config.matcher`;
  // do not skip on '.' in the path, or dynamic routes like /api/opportunities/a.b bypass auth.
  // /supabase/auth/v1/* is forwarded to Supabase Auth (next.config.js), which does its own auth:
  // signing up and in must work before the visitor has a session.
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/supabase/auth/v1/')
  ) {
    return NextResponse.next();
  }

  // 2. Prepare Next.js response that can receive updated cookies
  let response = NextResponse.next({
    request: {
      headers: req.headers
    }
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    // Unconfigured Supabase is a supported local-dev mode, but in production it must not
    // turn the auth gate off: route handlers re-check auth and would fail closed anyway.
    if (process.env.NODE_ENV !== 'production') {
      return response;
    }
    if (pathname.startsWith('/api/health') || pathname === '/api/config/status') {
      return response;
    }
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: { code: 'NOT_CONFIGURED', message: 'Authentication backend is not configured.' } },
        { status: 503 }
      );
    }
    return new NextResponse(
      '<!doctype html><meta charset="utf-8"><title>Service unavailable</title>' +
        '<p style="font-family:system-ui;margin:3rem auto;max-width:36rem">' +
        'Research Opportunity Radar is not configured yet: authentication settings are missing. ' +
        'Operators: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see DEPLOY_CHECKLIST.md).</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return req.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        req.cookies.set({ name, value });
        response = NextResponse.next({
          request: {
            headers: req.headers
          }
        });
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        req.cookies.set({ name, value: '' });
        response = NextResponse.next({
          request: {
            headers: req.headers
          }
        });
        response.cookies.set({ name, value: '', ...options, maxAge: 0 });
      }
    }
  });

  // Refresh auth token
  const { data: { user } } = await supabase.auth.getUser();

  const isPublic =
    PUBLIC_EXACT_PATHS.has(pathname) ||
    // Telegram has no user session; the route authenticates it with the webhook secret header
    (pathname === '/api/telegram/webhook' && req.method === 'POST') ||
    (pathname === '/api/opportunities' && req.method === 'GET') ||
    (pathname === '/api/deadlines' && req.method === 'GET');

  const isAuthPage =
    pathname === '/login' ||
    pathname === '/register' ||
    pathname === '/forgot-password' ||
    pathname === '/reset-password';

  // 3. If user is logged in and visits auth pages, redirect to home
  if (user && isAuthPage) {
    const nextUrl = safeRedirectPath(req.nextUrl.searchParams.get('next'));
    return NextResponse.redirect(new URL(nextUrl, req.url));
  }

  // 4. If route is protected and user is not authenticated:
  if (!user && !isPublic) {
    // API routes return 401 JSON
    if (pathname.startsWith('/api/')) {
      // Check if request carries operator secret (CI/Worker bypass)
      const operatorSecret = process.env.RADAR_API_SECRET;
      const secretHeader = req.headers.get('x-radar-secret');
      const authHeader = req.headers.get('authorization') || '';
      if (
        operatorSecret &&
        ((secretHeader && secretsMatch(secretHeader, operatorSecret)) ||
          (authHeader.startsWith('Bearer ') && secretsMatch(authHeader.slice(7).trim(), operatorSecret)))
      ) {
        return response;
      }

      return NextResponse.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required. Please log in or provide valid credentials.'
          }
        },
        { status: 401 }
      );
    }

    // Web pages redirect to /login with next return url
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (svg, png, jpg, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'
  ]
};
