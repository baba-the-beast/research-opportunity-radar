/**
 * External links on the dashboard come from scraped agency pages. Render them only when they are
 * http(s): a "javascript:" or "data:" href from a compromised or malformed source page must never
 * become a clickable link (React 19 also blocks javascript: URLs; this is defence in depth).
 */
export function safeExternalUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}
