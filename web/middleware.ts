import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_EXACT_PATHS = new Set([
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/api/auth/callback',
  '/api/health',
  '/api/health/live',
  '/api/health/ready',
  '/api/health/deps',
  '/api/config/health'
]);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. Skip static assets, internal paths, and favicon
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.includes('.') ||
    pathname.startsWith('/favicon')
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

  // In test environment or if Supabase is intentionally unconfigured, allow local dev access
  const isDevOrTest = process.env.NODE_ENV === 'test' || !supabaseUrl || !supabaseAnonKey;
  if (isDevOrTest) {
    return response;
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
    pathname.startsWith('/api/health') ||
    pathname.startsWith('/api/config/health') ||
    (pathname === '/api/opportunities' && req.method === 'GET') ||
    (pathname === '/api/deadlines' && req.method === 'GET');

  const isAuthPage =
    pathname === '/login' ||
    pathname === '/register' ||
    pathname === '/forgot-password' ||
    pathname === '/reset-password';

  // 3. If user is logged in and visits auth pages, redirect to home
  if (user && isAuthPage) {
    const nextUrl = req.nextUrl.searchParams.get('next') || '/';
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
        (secretHeader && operatorSecret && secretHeader === operatorSecret) ||
        (authHeader.startsWith('Bearer ') && operatorSecret && authHeader.slice(7).trim() === operatorSecret)
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
