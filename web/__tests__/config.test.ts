import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isSupabaseConfigured, getSupabaseServerClient } from '../lib/supabaseServerClient';

describe('Supabase Configuration Utility', () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  afterEach(() => {
    process.env.SUPABASE_URL = originalUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  });

  it('returns false when credentials are missing', () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(isSupabaseConfigured()).toBe(false);
  });

  it('returns true when credentials are fully configured', () => {
    process.env.SUPABASE_URL = 'https://xyz.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'secret-service-role-key';
    expect(isSupabaseConfigured()).toBe(true);
  });

  it('throws descriptive configuration error when calling getSupabaseServerClient unconfigured', () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => getSupabaseServerClient()).toThrow(/SUPABASE_CONFIGURATION_REQUIRED/);
  });
});
