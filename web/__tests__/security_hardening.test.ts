import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeExternalUrl } from '../lib/safeUrl';
import { createErrorResponse } from '../lib/apiResponse';

describe('external links from scraped sources', () => {
  it('keeps http(s) links', () => {
    expect(safeExternalUrl('https://dbt.gov.in/storage/call.pdf')).toBe('https://dbt.gov.in/storage/call.pdf');
    expect(safeExternalUrl('http://www.wikicfp.com/cfp/servlet/event.showcfp?eventid=1')).toContain('wikicfp.com');
  });

  it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', '//evil.com', '', null, undefined])(
    'drops %s',
    (url) => {
      expect(safeExternalUrl(url as any)).toBeUndefined();
    }
  );
});

describe('server error responses', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('hide internal details from callers in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = createErrorResponse('DATABASE_ERROR', 'column "secret_col" of relation "faculty_profile" does not exist', 500);
    const body = await res.json();
    expect(body.error.message).not.toContain('faculty_profile');
    expect(body.error.message).toContain(body.error.requestId);
  });

  it('keep client-error messages (they explain what to fix)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const body = await createErrorResponse('VALIDATION_ERROR', 'Invalid profile payload', 400).json();
    expect(body.error.message).toBe('Invalid profile payload');
  });
});
