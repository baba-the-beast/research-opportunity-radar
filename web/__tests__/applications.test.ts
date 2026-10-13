import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APPLICATION_STATUSES, STAGE, TRACK_STATUSES, isApplication, stageStep } from '../lib/applications';

describe('application tracker stages', () => {
  it('keeps the stored values the pipeline already relies on', () => {
    // radar/db/client.py sends reminders for saved, pursuing or applied calls
    expect(TRACK_STATUSES).toEqual(expect.arrayContaining(['new', 'pursuing', 'applied', 'dismissed']));
  });

  it('treats only real application stages as applications', () => {
    for (const s of APPLICATION_STATUSES) expect(isApplication(s)).toBe(true);
    for (const s of ['new', 'dismissed', '', null, undefined, 'PURSUING']) expect(isApplication(s as string)).toBe(false);
  });

  it('orders the stages Preparing -> Submitted -> Outcome', () => {
    expect(stageStep('pursuing')).toBe(0);
    expect(stageStep('applied')).toBe(1);
    expect(stageStep('awarded')).toBe(2);
    expect(stageStep('not_awarded')).toBe(2);
  });

  it('has a label for every application stage', () => {
    for (const s of APPLICATION_STATUSES) expect(STAGE[s].label.length).toBeGreaterThan(0);
  });

  it('matches the database check constraint in the latest migration that sets it', () => {
    const dir = join(__dirname, '..', '..', 'supabase', 'migrations');
    const latest = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => readFileSync(join(dir, f), 'utf-8'))
      .filter((sql) => /user_opportunity_state_status_check/.test(sql))
      .pop();
    expect(latest).toBeDefined();
    const allowed = latest!.match(/check \(status in \(([^)]+)\)\)/)![1].split(',').map((v) => v.trim().replace(/'/g, ''));
    expect([...allowed].sort()).toEqual([...TRACK_STATUSES].sort());
  });
});
