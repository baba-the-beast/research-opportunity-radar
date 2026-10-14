import { describe, expect, it } from 'vitest';
import { canonicalInstitution, matchKnownInstitutions, mergeSuggestions } from '../lib/institutions';

describe('institution picker', () => {
  it('finds official names from common short forms', () => {
    expect(matchKnownInstitutions('IIT Bombay')).toContain('Indian Institute of Technology Bombay');
    expect(matchKnownInstitutions('sppu')).toEqual(['Savitribai Phule Pune University']);
    expect(matchKnownInstitutions('i')).toEqual([]); // too short to search
  });

  it('puts names colleagues already use first and drops spelling duplicates', () => {
    expect(mergeSuggestions(['COEP Technological University '], ['coep technological university', 'Indian Institute of Science'])).toEqual([
      'COEP Technological University',
      'Indian Institute of Science'
    ]);
  });
});

describe('canonicalInstitution', () => {
  it('saves the official name for an exact short form, and leaves other names alone', () => {
    expect(canonicalInstitution(' iit bombay ')).toBe('Indian Institute of Technology Bombay');
    expect(canonicalInstitution('Government College of Arts, Nagpur')).toBe('Government College of Arts, Nagpur');
  });
});
