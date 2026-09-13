import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../app/api/profile/orcid/route';
import fs from 'fs';
import path from 'path';

describe('ORCID API Route & Parser Parity', () => {
  const fixturePath = path.resolve(__dirname, '../../tests/fixtures/orcid_2026_sample.json');
  const sampleData = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('correctly parses shared ORCID fixture matching Python orcid_client output', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sampleData,
    }));

    const req = new NextRequest('http://localhost:3000/api/profile/orcid?orcid=0000-0002-1825-0097');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.orcid).toBe('0000-0002-1825-0097');
    expect(body.full_name).toBe('Vibha Patil');
    expect(body.institution).toBe('College of Engineering Pune');
    expect(body.department).toBe('Department of Computer Engineering');
    expect(body.keywords).toContain('graph neural networks');
    expect(body.keywords).toContain('fraud detection');
    expect(body.career_stage).toBe('mid_career');
    expect(body.phd_year).toBe(2018);

    const termNames = body.candidate_terms.map((t: any) => t.term);
    expect(termNames).toContain('graph neural networks');
    expect(termNames).toContain('fraud detection');
    expect(termNames).toContain('IEEE Transactions on Neural Networks');
    expect(body.candidate_terms.some((t: any) => t.term_type === 'venue')).toBe(true);
    expect(body.candidate_terms.some((t: any) => t.term_type === 'topic')).toBe(true);
  });

  it('rejects invalid ORCID formats', async () => {
    const req = new NextRequest('http://localhost:3000/api/profile/orcid?orcid=invalid-id');
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid ORCID iD format');
  });
});
