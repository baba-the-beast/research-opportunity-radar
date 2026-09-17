import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const settingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  min_score: z.number().int().min(0).max(100),
  email_alerts: z.boolean(),
  telegram_alerts: z.boolean(),
  telegram_chat_id: z.string().max(64).nullable(),
  digest_frequency: z.enum(['daily', 'weekly', 'never'])
});

describe('Theme and Preferences Validation Tests', () => {
  it('accepts valid theme options and preferences', () => {
    const validLight = {
      theme: 'light',
      min_score: 50,
      email_alerts: true,
      telegram_alerts: false,
      telegram_chat_id: null,
      digest_frequency: 'weekly'
    };
    expect(settingsSchema.safeParse(validLight).success).toBe(true);

    const validDark = { ...validLight, theme: 'dark' };
    expect(settingsSchema.safeParse(validDark).success).toBe(true);

    const validSystem = { ...validLight, theme: 'system' };
    expect(settingsSchema.safeParse(validSystem).success).toBe(true);
  });

  it('rejects invalid theme names', () => {
    const invalid = {
      theme: 'neon-cyberpunk',
      min_score: 50,
      email_alerts: true,
      telegram_alerts: false,
      telegram_chat_id: null,
      digest_frequency: 'weekly'
    };
    expect(settingsSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects out-of-bounds score thresholds', () => {
    const outOfBounds = {
      theme: 'light',
      min_score: 150,
      email_alerts: true,
      telegram_alerts: false,
      telegram_chat_id: null,
      digest_frequency: 'weekly'
    };
    expect(settingsSchema.safeParse(outOfBounds).success).toBe(false);
  });
});
