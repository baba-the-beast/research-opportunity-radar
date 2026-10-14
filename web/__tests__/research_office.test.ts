import { describe, expect, it } from 'vitest';
import { authorizeRole } from '../lib/auth';
import { institutionKey } from '../lib/institution';

describe('research office accounts', () => {
  const office = { id: 'u1', role: 'research_office' as const, isServiceRole: false };

  it('can do everything a faculty account can', () => {
    expect(authorizeRole(office, ['faculty', 'operator', 'admin']).authorized).toBe(true);
  });

  it('do not get operator-only access', () => {
    expect(authorizeRole(office, ['operator']).authorized).toBe(false);
  });
});

describe('institutionKey', () => {
  it('ignores case and spacing, like the database function', () => {
    expect(institutionKey('  COEP   Technological University ')).toBe('coep technological university');
    expect(institutionKey(null)).toBe('');
  });
});
