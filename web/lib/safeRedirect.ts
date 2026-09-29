/**
 * Returns a same-origin relative path for post-auth redirects, or '/' if the value could
 * leave the site: absolute URLs, protocol-relative '//host', backslashes (browsers treat '\' as '/'),
 * and ASCII control characters / whitespace. Browsers and the WHATWG URL parser strip tab, CR and LF,
 * so '/<TAB>/evil.com' would otherwise become '//evil.com'. Kept dependency-free for Edge middleware.
 */
const UNSAFE_CHARS = /[\u0000- \u007f\\]/;

export function safeRedirectPath(next: string | null | undefined): string {
  if (!next || UNSAFE_CHARS.test(next)) {
    return '/';
  }
  if (!next.startsWith('/') || next.startsWith('//')) {
    return '/';
  }
  return next;
}
