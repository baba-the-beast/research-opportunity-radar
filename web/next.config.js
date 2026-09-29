/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV !== 'production';

// The browser only talks to this origin, Google Fonts and Supabase (auth). Every other external API
// (OpenAI, Gemini, ORCID, OpenAlex, GitHub) is called server-side and needs no CSP entry.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
let supabaseOrigins = 'https://*.supabase.co wss://*.supabase.co';
try {
  if (supabaseUrl) {
    const { host, protocol } = new URL(supabaseUrl);
    supabaseOrigins = `${protocol}//${host} ${protocol === 'https:' ? 'wss' : 'ws'}://${host}`;
  }
} catch {
  // keep the *.supabase.co default
}

const contentSecurityPolicy = [
  "default-src 'self'",
  // 'unsafe-inline': the pre-hydration theme script in app/layout.tsx and Next's inline bootstrap.
  // 'unsafe-eval' only for the dev server's React Refresh.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${supabaseOrigins}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]),
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

module.exports = nextConfig;
