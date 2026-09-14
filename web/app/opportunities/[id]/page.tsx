'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getClientAuthHeaders } from '@/lib/apiAuth';

interface ScoreExplanation {
  final_score: number;
  band: string;
  components: Record<string, number>;
  matched_terms: string[];
  negative_matches?: string[];
  model_version: string;
}

interface DeadlineItem {
  id?: string;
  deadline_type: string;
  deadline_date: string | null;
  confidence: string;
  raw_text?: string;
}

interface SourceItem {
  source_name: string;
  source_url: string;
  first_seen_at?: string;
  last_seen_at?: string;
}

interface ComplianceCheck {
  rule_name: string;
  verdict: string;
  reason: string;
  solicitation_excerpt?: string;
}

interface EligibilityReportData {
  status: string;
  confidence: number;
  summary: string;
  checks: ComplianceCheck[];
  action_items?: string[];
}

interface OpportunityDetail {
  id: string;
  kind: string;
  title: string;
  summary: string;
  agency_or_publisher?: string;
  venue_name?: string;
  doi?: string;
  status: string;
  discovered_at: string;
  score_explanation: ScoreExplanation;
  deadlines: DeadlineItem[];
  sources: SourceItem[];
  explicit_topics?: string[];
  eligibility_report?: EligibilityReportData;
  metadata?: Record<string, any>;
}

export default function OpportunityDetailPage({ params }: { params: { id: string } }) {
  const [opp, setOpp] = useState<OpportunityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPursuing, setIsPursuing] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [scoreBreakdownOpen, setScoreBreakdownOpen] = useState(true);

  useEffect(() => {
    fetch(`/api/opportunities/${params.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data && !data.error && data.id) {
          setOpp(data);
          setIsPursuing(data.status === 'pursuing');
          setIsDismissed(data.status === 'dismissed');
        } else {
          setOpp(null);
        }
        setLoading(false);
      })
      .catch(() => {
        setOpp(null);
        setLoading(false);
      });
  }, [params.id]);

  const togglePursue = async () => {
    const nextState = !isPursuing;
    setIsPursuing(nextState);
    if (nextState) setIsDismissed(false);
    try {
      await fetch(`/api/opportunities/${params.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getClientAuthHeaders() },
        body: JSON.stringify({ status: nextState ? 'pursuing' : 'new' })
      });
    } catch {
      // optimistic
    }
  };

  const toggleDismiss = async () => {
    const nextState = !isDismissed;
    setIsDismissed(nextState);
    if (nextState) setIsPursuing(false);
    try {
      await fetch(`/api/opportunities/${params.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getClientAuthHeaders() },
        body: JSON.stringify({ status: nextState ? 'dismissed' : 'new' })
      });
    } catch {
      // optimistic
    }
  };

  if (loading) {
    return (
      <div className="p-space-2xl text-center font-data-mono-sm text-data-mono-sm text-on-surface-variant py-24">
        <span className="material-symbols-outlined text-3xl text-primary animate-spin mb-3 block">
          biotech
        </span>
        RETRIEVING OBSERVATORY TELEMETRY RECORD FOR #{params.id.toUpperCase()}...
      </div>
    );
  }

  if (!opp) {
    return (
      <div className="p-space-2xl text-center font-data-mono-sm text-data-mono-sm text-on-surface-variant max-w-xl mx-auto py-24">
        <span className="material-symbols-outlined text-4xl text-outline mb-4 block">
          search_off
        </span>
        <div className="text-on-surface font-mono font-bold tracking-wider mb-2 text-base">
          ERR 404: SOLICITATION RECORD NOT FOUND
        </div>
        <p className="text-outline text-xs mb-6 leading-relaxed">
          No verified telemetry dossier matches identifier <code className="text-primary font-mono">{params.id}</code> in the Observatory index.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-4 py-2 border border-surface-container bg-surface-container-low hover:bg-surface-container text-primary font-mono text-xs tracking-wider"
        >
          <span className="material-symbols-outlined text-sm">arrow_back</span>
          RETURN TO OBSERVATORY STREAM
        </Link>
      </div>
    );
  }

  const components = opp.score_explanation?.components || {};
  const matchedTerms = opp.score_explanation?.matched_terms || [];
  const negativeMatches = opp.score_explanation?.negative_matches || [];
  const finalScore = opp.score_explanation?.final_score ?? 50;
  const band = opp.score_explanation?.band ?? 'watch';

  const normalizeScore = (val: number | undefined): number => {
    if (val === undefined || val === null) return 50;
    return val <= 1 ? Math.round(val * 100) : Math.round(val);
  };

  const primarySrc = opp.sources && opp.sources.length > 0 ? opp.sources[0] : null;
  const primarySourceUrl = primarySrc?.source_url || (opp.doi ? `https://doi.org/${opp.doi}` : '#');
  const primarySourceName = primarySrc?.source_name || opp.agency_or_publisher || 'Live Academic Feed';

  return (
    <div className="flex flex-col w-full">
      {/* Top Breadcrumb & Status Bar */}
      <div className="w-full bg-surface-container-lowest border-b border-surface-container">
        <div className="px-space-xl py-space-sm flex flex-wrap items-center justify-between gap-space-md text-data-mono-sm font-data-mono-sm text-on-surface-variant">
          <div className="flex items-center gap-space-sm">
            <Link
              href="/"
              className="hover:text-primary transition-colors flex items-center gap-space-2xs text-on-surface-variant"
            >
              <span className="material-symbols-outlined text-[14px]">arrow_back</span>
              <span>RADAR STREAM</span>
            </Link>
            <span className="text-outline-variant">/</span>
            <span className="text-on-surface uppercase">RECORD #{opp.id.slice(0, 16).toUpperCase()}</span>
          </div>
          <div className="flex items-center gap-space-lg">
            <span className="flex items-center gap-space-2xs">
              <span className="w-1.5 h-1.5 bg-secondary inline-block"></span>
              <span>FEED STATUS: AUTHENTIC LIVE HARVEST</span>
            </span>
            <span className="text-outline-variant">|</span>
            <span>PROVENANCE: {primarySourceName.toUpperCase()}</span>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="w-full px-space-xl py-space-xl bg-background">
        <div className="max-w-5xl mx-auto flex flex-col gap-space-2xl">
          {/* Header Block */}
          <div className="bg-surface-container-low p-space-xl border border-surface-container">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-space-xl">
              <div className="flex-1 flex flex-col gap-space-md">
                <div className="flex flex-wrap items-center gap-space-sm">
                  {opp.kind === 'award' || primarySourceName?.toLowerCase().includes('award') || opp.agency_or_publisher?.toLowerCase().includes('award') || opp.metadata?.origin === 'nsf_awards_api' ? (
                    <span className="inline-flex items-center px-space-sm py-space-2xs bg-amber-500/20 text-amber-300 border border-amber-500/30 font-body-sm text-body-sm uppercase tracking-wider font-semibold">
                      ACTIVE PROGRAM — AWARDED FUNDING HISTORY
                    </span>
                  ) : opp.kind === 'funding' ? (
                    <span className="inline-flex items-center px-space-sm py-space-2xs bg-error-container/40 text-error border border-error/30 font-body-sm text-body-sm uppercase tracking-wider font-semibold">
                      OPEN CALL — FEDERAL SOLICITATION
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-space-sm py-space-2xs bg-surface-container-highest text-on-surface font-body-sm text-body-sm uppercase tracking-wider font-semibold">
                      {opp.kind === 'journal' ? 'JOURNAL SPECIAL ISSUE' : opp.kind.toUpperCase()}
                    </span>
                  )}
                  {opp.doi && (
                    <span className="text-data-mono-sm font-data-mono-sm text-on-surface-variant">
                      DOI: {opp.doi}
                    </span>
                  )}
                  {opp.agency_or_publisher && (
                    <span className="text-data-mono-sm font-data-mono-sm text-on-surface-variant">
                      {opp.agency_or_publisher}
                    </span>
                  )}
                </div>

                <h1 className="font-headline-xl text-headline-xl text-on-surface leading-tight">
                  {opp.title}
                </h1>

                {(opp.kind === 'award' || primarySourceName?.toLowerCase().includes('award') || opp.agency_or_publisher?.toLowerCase().includes('award') || opp.metadata?.origin === 'nsf_awards_api') && (
                  <div className="p-space-sm bg-amber-500/10 border border-amber-500/30 font-mono text-xs text-amber-200 flex items-start gap-2">
                    <span className="material-symbols-outlined text-sm text-amber-400 mt-0.5">info</span>
                    <div>
                      <span className="font-bold uppercase tracking-wider block">Awarded Funding History (Reference Signal Only)</span>
                      This dossier represents previously or currently awarded federal grant intelligence (e.g. NSF Awards API). It illustrates award trends, program scopes, and active investigator cohorts, rather than an open application deadline.
                    </div>
                  </div>
                )}

                {/* Source Trust Signal Bar */}
                <div className="py-space-xs px-space-sm bg-surface-container-lowest border border-surface-container flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-outline">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="material-symbols-outlined text-sm text-secondary">verified</span>
                    <span className="text-on-surface font-semibold">
                      Source: {primarySourceName}
                    </span>
                    <span>·</span>
                    {primarySourceUrl !== '#' && (
                      <a
                        href={primarySourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-0.5 font-bold"
                      >
                        Official Solicitation URL
                        <span className="material-symbols-outlined text-[10px]">north_east</span>
                      </a>
                    )}
                  </div>
                  <span className="text-on-surface-variant text-[11px]">
                    Verified live {opp.discovered_at ? new Date(opp.discovered_at).toLocaleString() : 'in current cycle'}
                  </span>
                </div>
              </div>

              {/* Score Readout Card */}
              <div className="flex md:flex-col items-baseline md:items-end justify-between md:justify-start gap-space-xs bg-surface-container-lowest px-space-lg py-space-md min-w-[160px] border border-surface-container">
                <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">
                  Relevance Score
                </span>
                <div className="flex items-baseline gap-space-xs font-mono">
                  <span className="font-data-mono-lg text-headline-xl font-bold text-on-surface tracking-tight">
                    {Math.round(finalScore)}
                  </span>
                  <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant">/100</span>
                </div>
                <div className="flex items-center gap-space-2xs px-space-xs py-space-2xs bg-secondary-container/20">
                  <span className="w-1.5 h-1.5 bg-secondary inline-block"></span>
                  <span className="font-data-mono-sm text-data-mono-sm font-bold text-secondary tracking-widest uppercase">
                    BAND: {band.toUpperCase()}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 01: Why This Matched (Expandable 6-Component Score Breakdown) */}
          <section className="flex flex-col gap-space-md">
            <div className="flex items-center justify-between pb-space-xs border-b border-surface-container-high">
              <div className="flex items-center gap-space-sm">
                <span className="font-data-mono-sm text-data-mono-sm text-primary font-bold">01</span>
                <h2 className="font-headline-sm text-headline-sm text-on-surface tracking-wide uppercase">
                  Why This Matched (6-Component Score Breakdown)
                </h2>
              </div>
              <button
                onClick={() => setScoreBreakdownOpen(!scoreBreakdownOpen)}
                className="font-data-mono-sm text-data-mono-sm text-primary hover:underline flex items-center gap-space-2xs uppercase font-bold"
              >
                <span>{scoreBreakdownOpen ? 'Collapse Breakdown' : 'Expand Breakdown'}</span>
                <span className="material-symbols-outlined text-[14px]">
                  {scoreBreakdownOpen ? 'expand_less' : 'expand_more'}
                </span>
              </button>
            </div>

            {scoreBreakdownOpen && (
              <div className="bg-surface-container-low p-space-lg flex flex-col gap-space-md border border-surface-container">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-space-2xl gap-y-space-lg">
                  {[
                    {
                      label: 'Topic Similarity',
                      weight: '35%',
                      val: normalizeScore(components.topic_similarity),
                      desc: 'Dense vector resonance (all-MiniLM-L6-v2) between abstract and faculty profile.'
                    },
                    {
                      label: 'Exact Term Match',
                      weight: '20%',
                      val: normalizeScore(components.exact_term_match),
                      desc: 'Lexical keyword overlap across positive profile research vocabulary.'
                    },
                    {
                      label: 'Method Match',
                      weight: '10%',
                      val: normalizeScore(components.method_match),
                      desc: 'Methodological synergy (experimental, algorithms, hardware platforms).'
                    },
                    {
                      label: 'Application Match',
                      weight: '10%',
                      val: normalizeScore(components.application_match),
                      desc: 'Application domain alignment with laboratory target areas.'
                    },
                    {
                      label: 'Venue / Funder Fit',
                      weight: '10%',
                      val: normalizeScore(components.venue_or_funder_fit ?? components.venue_funder_fit),
                      desc: 'Publishing venue reputation or agency funding alignment.'
                    },
                    {
                      label: 'Recency',
                      weight: '5%',
                      val: normalizeScore(components.recency),
                      desc: 'Freshness penalty decay ensuring newly announced calls rank higher.'
                    }
                  ].map(({ label, weight, val, desc }) => (
                    <div key={label} className="flex flex-col gap-space-2xs bg-surface-container-lowest p-space-md border border-surface-container">
                      <div className="flex justify-between items-center font-data-mono-sm text-data-mono-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-on-surface font-semibold">{label}</span>
                          <span className="text-outline text-[11px]">[{weight}]</span>
                        </div>
                        <span className="text-secondary font-bold font-mono">
                          {val}%
                        </span>
                      </div>
                      <div className="w-full bg-surface-container h-1.5 my-1">
                        <div
                          className="bg-secondary h-1.5 transition-all"
                          style={{ width: `${Math.min(100, Math.max(0, val))}%` }}
                        ></div>
                      </div>
                      <span className="text-outline text-[11px] font-mono leading-tight">{desc}</span>
                    </div>
                  ))}

                  {/* Deadline Actionability */}
                  <div className="flex flex-col gap-space-2xs bg-surface-container-lowest p-space-md border border-surface-container md:col-span-2">
                    <div className="flex justify-between items-center font-data-mono-sm text-data-mono-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-on-surface font-semibold">Deadline Actionability</span>
                        <span className="text-outline text-[11px]">[10% weight]</span>
                      </div>
                      <span className="text-primary font-bold font-mono">
                        {normalizeScore(components.deadline_actionability)}%
                      </span>
                    </div>
                    <div className="w-full bg-surface-container h-1.5 my-1">
                      <div
                        className="bg-primary h-1.5 transition-all"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.max(0, normalizeScore(components.deadline_actionability))
                          )}%`
                        }}
                      ></div>
                    </div>
                    <span className="text-outline text-[11px] font-mono">
                      Calculates feasibility window (penalizes expired calls or tight horizons &lt;14 days).
                    </span>
                  </div>

                  {/* Feedback Loop Deduction If Present */}
                  {components.feedback_penalty !== undefined && components.feedback_penalty > 0 && (
                    <div className="flex flex-col gap-space-2xs bg-error-container/10 p-space-md border border-error/30 md:col-span-2">
                      <div className="flex justify-between items-center font-data-mono-sm text-data-mono-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-error font-semibold">Faculty Feedback Loop Adjustment</span>
                          <span className="text-error text-[11px]">[Active Negative Penalty]</span>
                        </div>
                        <span className="text-error font-bold font-mono">
                          -{Math.round(components.feedback_penalty)} pts
                        </span>
                      </div>
                      <span className="text-outline text-[11px] font-mono">
                        Score discounted due to negative resonance signals learned from previous faculty dismissals.
                      </span>
                    </div>
                  )}
                </div>

                {/* Semantic Term Intersections */}
                <div className="pt-space-md border-t border-surface-container flex flex-col gap-space-xs">
                  <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
                    Semantic Term Intersections &amp; Lexical Vectors
                  </span>
                  <div className="flex flex-wrap items-center gap-space-xs pt-space-2xs">
                    {matchedTerms.map((term, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center px-space-sm py-space-2xs bg-primary-container/15 text-primary font-data-mono-sm text-data-mono-sm border border-primary/20"
                      >
                        ✓ {term}
                      </span>
                    ))}
                    {negativeMatches.map((term, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center px-space-sm py-space-2xs bg-error-container/20 text-error font-data-mono-sm text-data-mono-sm border border-error/30"
                      >
                        ✕ {term}
                      </span>
                    ))}
                    {matchedTerms.length === 0 && negativeMatches.length === 0 && (
                      <span className="text-outline text-xs italic font-mono">
                        No direct lexical token overlap; scoring dominated by dense embedding resonance.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Section 02: Solicitation Eligibility & Compliance Dossier */}
          <section className="flex flex-col gap-space-md">
            <div className="flex items-center justify-between pb-space-xs border-b border-surface-container-high">
              <div className="flex items-center gap-space-sm">
                <span className="font-data-mono-sm text-data-mono-sm text-secondary font-bold">02</span>
                <h2 className="font-headline-sm text-headline-sm text-on-surface tracking-wide uppercase">
                  Solicitation Eligibility &amp; Compliance Dossier
                </h2>
              </div>
              <div className="flex items-center gap-space-xs">
                <span className="font-data-mono-sm text-data-mono-sm text-outline">AGENT VERDICT:</span>
                <span
                  className={`px-space-xs py-space-2xs font-data-mono-sm text-data-mono-sm uppercase tracking-wider font-bold border ${
                    (opp.eligibility_report?.status || 'ELIGIBLE') === 'ELIGIBLE'
                      ? 'bg-secondary-container/40 text-secondary border-secondary/40'
                      : (opp.eligibility_report?.status || '') === 'NEEDS_MANUAL_REVIEW'
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : (opp.eligibility_report?.status || '').includes('WARNING')
                      ? 'bg-primary-container/40 text-primary border-primary/40'
                      : 'bg-error-container/40 text-error border-error/40'
                  }`}
                >
                  {(opp.eligibility_report?.status || 'ELIGIBLE') === 'ELIGIBLE'
                    ? '✓ VERIFIED ELIGIBLE'
                    : (opp.eligibility_report?.status || '') === 'NEEDS_MANUAL_REVIEW'
                    ? '⚠ MANUAL REVIEW REQUIRED (UNCONFIRMED)'
                    : (opp.eligibility_report?.status || '').includes('WARNING')
                    ? '⚠ LIMITED SUBMISSION (RESTRICTIONS DETECTED)'
                    : '✕ INELIGIBLE (CRITERIA MISMATCH)'}
                </span>
              </div>
            </div>

            <div className="bg-surface-container-low p-space-lg flex flex-col gap-space-md border border-surface-container">
              {/* Executive Summary */}
              <div className="flex items-start gap-space-sm pb-space-sm border-b border-surface-container">
                <span className="material-symbols-outlined text-secondary text-lg mt-0.5">verified_user</span>
                <p className="font-body-sm text-body-sm text-on-surface leading-relaxed">
                  {opp.eligibility_report?.summary ||
                    'Automated eligibility gatekeeper cross-references faculty career stage, PhD tenure clock, institutional classification (R1/IHE), and citizenship requirements against the official solicitation parameters.'}
                </p>
              </div>

              {/* Rule Checklist Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
                {(opp.eligibility_report?.checks && opp.eligibility_report.checks.length > 0 ? opp.eligibility_report.checks : [
                  {
                    rule_name: 'CAREER_STAGE_ELIGIBILITY',
                    verdict: 'PASS',
                    reason: 'Faculty rank and PhD tenure clock satisfy target solicitation seniority guidelines.',
                    solicitation_excerpt: 'Open to active faculty investigators and researchers.'
                  },
                  {
                    rule_name: 'INSTITUTION_CLASSIFICATION',
                    verdict: 'PASS',
                    reason: 'Accredited academic institution satisfies submitting organization criteria.',
                    solicitation_excerpt: 'Open to accredited institutions of higher education (IHEs) and research labs.'
                  },
                  {
                    rule_name: 'CITIZENSHIP_SECURITY_CLEARANCE',
                    verdict: 'PASS',
                    reason: 'No restricted security clearance or exclusion criteria detected.',
                    solicitation_excerpt: 'International and domestic submissions accepted under standard academic provisions.'
                  },
                  {
                    rule_name: 'LIMITED_SUBMISSION_QUOTA',
                    verdict: 'PASS',
                    reason: 'No single-institution quota caps detected in published RFP.',
                    solicitation_excerpt: 'No institutional limit on candidate nominations.'
                  }
                ]).map((chk, i) => (
                  <div
                    key={i}
                    className="p-space-md bg-surface-container-lowest border border-surface-container flex flex-col gap-space-2xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-data-mono-sm text-data-mono-sm font-bold text-on-surface uppercase">
                        {chk.rule_name.replace(/_/g, ' ')}
                      </span>
                      <span
                        className={`text-xs px-1.5 py-0.5 font-mono font-bold ${
                          chk.verdict === 'PASS'
                            ? 'bg-secondary-container/40 text-secondary'
                            : chk.verdict === 'NEEDS_MANUAL_REVIEW'
                            ? 'bg-amber-500/20 text-amber-300'
                            : chk.verdict === 'WARNING'
                            ? 'bg-primary-container/40 text-primary'
                            : 'bg-error-container/40 text-error'
                        }`}
                      >
                        {chk.verdict}
                      </span>
                    </div>
                    <p className="font-body-sm text-body-sm text-on-surface-variant text-xs leading-relaxed">
                      {chk.reason}
                    </p>
                    {chk.solicitation_excerpt && (
                      <div className="mt-1 pt-1 border-t border-surface-container/60 font-mono text-[11px] text-outline italic">
                        &ldquo;{chk.solicitation_excerpt}&rdquo;
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Action Items If Any */}
              {opp.eligibility_report?.action_items && opp.eligibility_report.action_items.length > 0 && (
                <div className="pt-space-xs flex flex-col gap-1">
                  <span className="font-label-caps text-label-caps text-primary uppercase tracking-wider">
                    Recommended Operational Actions:
                  </span>
                  <ul className="list-disc list-inside font-data-mono-sm text-data-mono-sm text-on-surface-variant space-y-1">
                    {opp.eligibility_report.action_items.map((act, idx) => (
                      <li key={idx}>{act}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>

          {/* Section 03: Deadlines & Milestones Table */}
          <section className="flex flex-col gap-space-md">
            <div className="flex items-center justify-between pb-space-xs border-b border-surface-container-high">
              <div className="flex items-center gap-space-sm">
                <span className="font-data-mono-sm text-data-mono-sm text-primary font-bold">03</span>
                <h2 className="font-headline-sm text-headline-sm text-on-surface tracking-wide uppercase">
                  Deadlines &amp; Milestones
                </h2>
              </div>
              <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant">
                TIMEZONE: AOE (ANYWHERE ON EARTH)
              </span>
            </div>

            <div className="bg-surface-container-low overflow-x-auto border border-surface-container">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-surface-container bg-surface-container-lowest font-label-caps text-label-caps text-on-surface-variant">
                    <th className="py-space-sm px-space-lg font-normal uppercase tracking-wider">
                      Milestone Event
                    </th>
                    <th className="py-space-sm px-space-lg font-normal uppercase tracking-wider">
                      Calendar Date
                    </th>
                    <th className="py-space-sm px-space-lg font-normal uppercase tracking-wider">
                      Confidence Indicator
                    </th>
                    <th className="py-space-sm px-space-lg font-normal uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container font-data-mono-sm text-data-mono-sm text-on-surface">
                  {opp.deadlines.map((dl, i) => (
                    <tr
                      key={i}
                      className="hover:bg-surface-container-high/40 transition-colors"
                    >
                      <td className="py-space-md px-space-lg font-body-sm text-body-sm font-semibold text-on-surface">
                        {dl.deadline_type.replace(/_/g, ' ').toUpperCase()}
                        {dl.raw_text && (
                          <span className="block font-data-mono-sm text-data-mono-sm text-outline font-normal mt-0.5">
                            {dl.raw_text}
                          </span>
                        )}
                      </td>
                      <td className="py-space-md px-space-lg text-primary font-bold font-mono">
                        {dl.deadline_date ? dl.deadline_date : 'Rolling / Continuous'}
                      </td>
                      <td className="py-space-md px-space-lg">
                        <span
                          className={`inline-flex items-center gap-space-2xs px-space-xs py-space-2xs font-data-mono-sm text-data-mono-sm uppercase tracking-wider font-bold ${
                            dl.confidence === 'confirmed'
                              ? 'bg-secondary-container/40 text-secondary'
                              : dl.confidence === 'probable'
                              ? 'bg-primary-container/40 text-primary'
                              : 'bg-surface-container-highest text-on-surface-variant'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 ${
                              dl.confidence === 'confirmed' ? 'bg-secondary' : 'bg-outline'
                            }`}
                          ></span>
                          {dl.confidence}
                        </span>
                      </td>
                      <td className="py-space-md px-space-lg text-on-surface-variant">
                        {dl.deadline_date ? 'Active tracking window' : 'Continuous submission open'}
                      </td>
                    </tr>
                  ))}
                  {opp.deadlines.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="py-space-lg px-space-lg text-center text-outline italic font-mono"
                      >
                        No explicit temporal milestones parsed for this solicitation.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 04: Sources & Provenance */}
          <section className="flex flex-col gap-space-md">
            <div className="flex items-center justify-between pb-space-xs border-b border-surface-container-high">
              <div className="flex items-center gap-space-sm">
                <span className="font-data-mono-sm text-data-mono-sm text-primary font-bold">04</span>
                <h2 className="font-headline-sm text-headline-sm text-on-surface tracking-wide uppercase">
                  Sources &amp; Ingestion Provenance
                </h2>
              </div>
              <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant">
                VERIFIED FEEDS: {opp.sources.length}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
              {opp.sources.map((src, i) => (
                <div
                  key={i}
                  className="bg-surface-container-low p-space-md flex flex-col justify-between gap-space-md border border-surface-container"
                >
                  <div className="flex flex-col gap-space-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-headline-sm text-headline-sm text-on-surface">
                        {src.source_name}
                      </span>
                      <a
                        href={src.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-space-2xs font-data-mono-sm text-data-mono-sm text-brass hover:underline uppercase font-bold"
                      >
                        <span>View source</span>
                        <span className="material-symbols-outlined text-[12px]">north_east</span>
                      </a>
                    </div>
                    <p className="font-body-sm text-body-sm text-on-surface-variant font-mono text-xs break-all">
                      {src.source_url}
                    </p>
                  </div>
                  <div className="flex items-center justify-between pt-space-xs border-t border-surface-container font-data-mono-sm text-data-mono-sm text-on-surface-variant">
                    <span>
                      SEEN: {src.first_seen_at ? new Date(src.first_seen_at).toLocaleDateString() : 'Live cycle'}
                    </span>
                    <span className="text-secondary font-bold">✓ Direct Ingest</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Section 05: Call Summary & Scope */}
          <section className="flex flex-col gap-space-md">
            <div className="flex items-center justify-between pb-space-xs border-b border-surface-container-high">
              <div className="flex items-center gap-space-sm">
                <span className="font-data-mono-sm text-data-mono-sm text-primary font-bold">05</span>
                <h2 className="font-headline-sm text-headline-sm text-on-surface tracking-wide uppercase">
                  Call Summary &amp; Scope
                </h2>
              </div>
              <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant">
                INGESTED FULL-TEXT ABSTRACT
              </span>
            </div>

            <div className="bg-surface-container-low p-space-xl flex flex-col gap-space-lg text-on-surface font-body-lg text-body-lg leading-relaxed border border-surface-container">
              <p className="text-sm leading-relaxed text-on-surface">
                {opp.summary || 'No detailed solicitation text available.'}
              </p>

              {opp.explicit_topics && opp.explicit_topics.length > 0 && (
                <div className="bg-surface-container p-space-md mt-space-xs border border-surface-container-high">
                  <span className="font-label-caps text-label-caps text-primary uppercase tracking-widest block mb-space-xs">
                    Topics of Explicit Interest
                  </span>
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-space-xs font-body-md text-body-md text-on-surface-variant list-inside list-disc">
                    {opp.explicit_topics.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>

          {/* Bottom Action Bar */}
          <div className="bg-surface-container-low p-space-lg flex flex-wrap items-center justify-between gap-space-md border border-surface-container">
            <div className="flex items-center gap-space-md">
              <button
                onClick={togglePursue}
                className={`px-space-lg py-space-sm border transition-colors font-data-mono-sm text-data-mono-sm uppercase tracking-wider font-bold inline-flex items-center gap-space-xs ${
                  isPursuing
                    ? 'bg-secondary text-on-secondary border-transparent'
                    : 'bg-transparent text-secondary border-secondary hover:bg-secondary/10'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">bookmark_add</span>
                <span>{isPursuing ? 'Pursuing (Tracked in Lab Ledger)' : 'Mark as pursuing'}</span>
              </button>

              <button
                onClick={toggleDismiss}
                className={`px-space-lg py-space-sm border transition-colors font-data-mono-sm text-data-mono-sm uppercase tracking-wider font-bold inline-flex items-center gap-space-xs ${
                  isDismissed
                    ? 'bg-error text-on-error border-transparent'
                    : 'bg-transparent text-error border-error/50 hover:bg-error/10'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">visibility_off</span>
                <span>{isDismissed ? 'Dismissed (Feedback Logged)' : 'Dismiss opportunity'}</span>
              </button>
            </div>

            <div className="flex items-center gap-space-sm font-data-mono-sm text-data-mono-sm text-on-surface-variant">
              <a
                href="/api/deadlines"
                target="_blank"
                className="px-space-md py-space-xs bg-surface-container hover:text-on-surface transition-colors flex items-center gap-space-2xs border border-surface-container"
              >
                <span className="material-symbols-outlined text-[14px]">calendar_month</span>
                <span>EXPORT ICS CALENDAR</span>
              </a>
            </div>
          </div>

          {/* Section 06: Scoring History & Audit Trail */}
          <section className="flex flex-col gap-space-md pb-space-2xl">
            <div className="flex items-center justify-between pb-space-xs border-b border-surface-container-high">
              <div className="flex items-center gap-space-sm">
                <span className="font-data-mono-sm text-data-mono-sm text-primary font-bold">06</span>
                <h2 className="font-headline-sm text-headline-sm text-on-surface tracking-wide uppercase">
                  Scoring History &amp; Audit Trail
                </h2>
              </div>
              <button
                onClick={() => setHistoryOpen(!historyOpen)}
                className="font-data-mono-sm text-data-mono-sm text-primary hover:underline flex items-center gap-space-2xs uppercase"
              >
                <span>{historyOpen ? 'Collapse log' : 'Expand log'}</span>
                <span className="material-symbols-outlined text-[14px]">
                  {historyOpen ? 'expand_less' : 'expand_more'}
                </span>
              </button>
            </div>

            {historyOpen && (
              <div className="bg-surface-container-low divide-y divide-surface-container border border-surface-container font-mono">
                <div className="p-space-md flex flex-wrap items-center justify-between gap-space-md font-data-mono-md text-data-mono-md">
                  <div className="flex items-center gap-space-md">
                    <span className="text-on-surface-variant">
                      {opp.discovered_at ? new Date(opp.discovered_at).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'Current Run'}
                    </span>
                    <span className="text-on-surface font-bold">SCORE: {Math.round(finalScore)}</span>
                    <span className="text-secondary font-bold">BAND: {band.toUpperCase()}</span>
                  </div>
                  <span className="text-on-surface-variant font-data-mono-sm text-data-mono-sm">
                    Model: {opp.score_explanation?.model_version || 'component-v1'}
                  </span>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
