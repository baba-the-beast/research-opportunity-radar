import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_REMINDER_DAYS, REMINDER_OPTIONS } from '../lib/reminders';

const migrations = () => {
  const dir = join(__dirname, '..', '..', 'supabase', 'migrations');
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(join(dir, f), 'utf-8'));
};

describe('deadline reminder options', () => {
  it('match the user_preferences check constraint', () => {
    const sql = migrations().filter((m) => /user_preferences_reminder_days_check/.test(m)).pop();
    expect(sql).toBeDefined();
    const allowed = sql!.match(/reminder_days <@ array\[([^\]]+)\]/)![1].split(',').map((v) => Number(v.trim()));
    expect([...allowed].sort((a, b) => a - b)).toEqual([...REMINDER_OPTIONS].sort((a, b) => a - b));
  });

  it('default to the original 3-day alert, matching the column default and the pipeline', () => {
    expect(DEFAULT_REMINDER_DAYS).toEqual([3]);
    const sql = migrations().find((m) => /add column if not exists reminder_days/.test(m))!;
    expect(sql).toMatch(/default '\{3\}'/);
    const py = readFileSync(join(__dirname, '..', '..', 'radar', 'notify', 'recipients.py'), 'utf-8');
    expect(py).toMatch(/ALLOWED_REMINDER_DAYS = \(1, 3, 7, 14, 30\)/);
  });
});
