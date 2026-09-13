/**
 * Public ORCID API Proxy & Profile Extraction Route
 * 
 * ARCHITECTURE / DUAL-IMPLEMENTATION NOTICE:
 * This route implements in TypeScript the same profile-extraction logic as the Python module
 * `radar.sources.orcid_client.parse_orcid_record_data`. This client-facing implementation runs
 * natively within Next.js to provide zero-latency profile pre-filling without spawning a Python process.
 * 
 * Both implementations are verified against the shared fixture:
 *   `tests/fixtures/orcid_2026_sample.json`
 * Any changes to parsing, career-stage calculations, or keyword/term extraction logic MUST be
 * synchronized across both `web/app/api/profile/orcid/route.ts` and `radar/sources/orcid_client.py`.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
  'to', 'from', 'is', 'are', 'was', 'were', 'using', 'based', 'via', 'study',
  'analysis', 'approach', 'new', 'novel', 'towards', 'improved', 'method',
  'systems', 'system', 'through', 'under', 'between', 'into', 'journal',
  'conference', 'proceedings', 'international', 'transactions'
]);

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const rawOrcid = searchParams.get('orcid');

  if (!rawOrcid) {
    return NextResponse.json({ error: 'Missing required orcid parameter.' }, { status: 400 });
  }

  const cleanOrcid = rawOrcid.replace(/^https?:\/\/[^/]+\//, '').replace(/\/$/, '').trim();
  const orcidRegex = /^\d{4}-\d{4}-\d{4}-[\dX]{4}$/;
  if (!orcidRegex.test(cleanOrcid)) {
    return NextResponse.json(
      { error: 'Invalid ORCID iD format. Expected format: 0000-0002-1825-0097' },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(`https://pub.orcid.org/v3.0/${cleanOrcid}/record`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ResearchOpportunityRadar/1.0 (+https://github.com/org/repo; contact: faculty@institution.edu)'
      },
      next: { revalidate: 3600 }
    });

    if (!res.ok) {
      if (res.status === 404) {
        return NextResponse.json({ error: `ORCID record for ${cleanOrcid} not found.` }, { status: 404 });
      }
      return NextResponse.json(
        { error: `ORCID API returned status ${res.status}: ${res.statusText}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    const person = data?.person || {};
    const nameInfo = person?.name || {};
    const given = nameInfo?.['given-names']?.value || '';
    const family = nameInfo?.['family-name']?.value || '';
    const fullName = `${given} ${family}`.trim();

    // Keywords
    const rawKeywords = person?.keywords?.keyword || [];
    const keywords: string[] = rawKeywords
      .map((k: any) => k?.content?.trim())
      .filter((k: string) => Boolean(k));

    // Affiliation / Employment
    const activities = data?.['activities-summary'] || {};
    const employments = activities?.employments?.['employment-summary'] || [];
    let institution = '';
    let department = '';
    if (Array.isArray(employments) && employments.length > 0) {
      const recent = employments[0];
      institution = recent?.organization?.name || '';
      department = recent?.['department-name'] || '';
    }

    // Works & Publication Years
    const worksGroups = activities?.works?.group || [];
    const workSummaries: string[] = [];
    const venues: string[] = [];
    const pubYears: number[] = [];
    const titleWords: string[] = [];

    if (Array.isArray(worksGroups)) {
      for (const grp of worksGroups) {
        const summaries = grp?.['work-summary'] || [];
        for (const w of summaries) {
          const title = w?.title?.title?.value || '';
          const venue = w?.['journal-title']?.value || '';
          const yearVal = w?.['publication-date']?.year?.value;

          if (yearVal) {
            const yr = parseInt(yearVal, 10);
            if (!isNaN(yr)) pubYears.push(yr);
          }

          if (title) {
            workSummaries.push(title);
            const words = title.toLowerCase().match(/[a-zA-Z]{3,}/g) || [];
            for (const wd of words) {
              if (!STOP_WORDS.has(wd)) {
                titleWords.push(wd);
              }
            }
          }

          if (venue) {
            venues.push(venue.trim());
          }
        }
      }
    }

    // Infer career stage
    const currentYear = new Date().getFullYear();
    let careerStage = 'mid_career';
    let phdYear: number | null = null;
    if (pubYears.length > 0) {
      phdYear = Math.min(...pubYears);
      const activeSpan = currentYear - phdYear;
      if (activeSpan <= 3) careerStage = 'early_career';
      else if (activeSpan <= 10) careerStage = 'mid_career';
      else careerStage = 'senior';
    }

    // Candidate Terms
    const candidateTerms: Array<{
      term: string;
      term_type: string;
      weight: number;
      polarity: string;
      source: string;
    }> = [];

    // 1. Keywords -> topic
    for (const kw of keywords.slice(0, 6)) {
      candidateTerms.push({
        term: kw,
        term_type: 'topic',
        weight: 1.0,
        polarity: 'positive',
        source: 'publication_seed'
      });
    }

    // 2. Word frequency in titles
    const counts: Record<string, number> = {};
    for (const wd of titleWords) {
      counts[wd] = (counts[wd] || 0) + 1;
    }
    const topWords = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    for (const [word] of topWords) {
      if (!candidateTerms.some((t) => t.term.toLowerCase() === word.toLowerCase())) {
        candidateTerms.push({
          term: word,
          term_type: 'topic',
          weight: 0.85,
          polarity: 'positive',
          source: 'publication_seed'
        });
      }
    }

    // 3. Top Venues
    const venueCounts: Record<string, number> = {};
    for (const vn of venues) {
      venueCounts[vn] = (venueCounts[vn] || 0) + 1;
    }
    const topVenues = Object.entries(venueCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);

    for (const [vn] of topVenues) {
      candidateTerms.push({
        term: vn,
        term_type: 'venue',
        weight: 0.9,
        polarity: 'positive',
        source: 'publication_seed'
      });
    }

    return NextResponse.json({
      orcid: cleanOrcid,
      full_name: fullName,
      institution,
      department,
      keywords: keywords.length > 0 ? keywords : candidateTerms.slice(0, 5).map((t) => t.term),
      profile_text: keywords.length > 0 ? `Research program focused on ${keywords.slice(0, 4).join(', ')}.` : '',
      career_stage: careerStage,
      phd_year: phdYear,
      candidate_terms: candidateTerms,
      works_count: workSummaries.length
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: `Failed to fetch ORCID metadata: ${error?.message || 'Network error'}` },
      { status: 500 }
    );
  }
}
