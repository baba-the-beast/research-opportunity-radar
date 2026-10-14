import { describe, expect, it } from 'vitest';
import { DEFAULT_SOURCES, withNewDefaults } from '../lib/sources';

describe('withNewDefaults', () => {
  it('switches on new funders for users who kept every old default', () => {
    const legacy = ['ANRF', 'DST', 'DBT', 'ICMR', 'BIRAC', 'CSIR', 'ICSSR', 'WikiCFP'];
    expect(new Set(withNewDefaults(legacy))).toEqual(new Set(DEFAULT_SOURCES));
  });

  it('keeps a choice exactly when the user turned a default off', () => {
    expect(withNewDefaults(['ANRF', 'WikiCFP'])).toEqual(['ANRF', 'WikiCFP']);
  });
});
