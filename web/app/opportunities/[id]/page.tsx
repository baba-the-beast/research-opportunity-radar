'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { safeExternalUrl } from '@/lib/safeUrl';
import { formatDeadline, formatIstDateTime, daysUntil } from '@/lib/dates';
import { bandLabel, bandTextClass, isGoodMatch, kindName } from '@/lib/match';
import { SendToTelegram } from '@/components/SendToTelegram';
import { eligibilityLabel } from '@/lib/eligibility';
import { EligibilityCorrection } from '@/components/EligibilityCorrection';
import { InstitutionNotePanel } from '@/components/InstitutionNotePanel';
import { ApplicationPanel } from '@/components/ApplicationPanel';
import { DismissPanel, type DismissChoice } from '@/components/DismissPanel';
import { PENALISING_REASON } from '@/lib/feedback';
import { TRACK_STATUSES, isApplication, type TrackStatus } from '@/lib/applications';
import { callShareText } from '@/lib/share';
import { Badge, Button, EmptyState, Icon, LoadingRows, Meter, Notice, Page, Panel, buttonClass, type Tone } from '@/components/ui';

interface ScoreExplanation {
  final_score: number | null; // null until the pipeline scores this opportunity for the user
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
  notes?: string;
  my_deadline?: string | null;
  my_deadline_label?: string;
  lifecycle_status?: string;
  discovered_at: string;
  score_explanation: ScoreExplanation;
  deadlines: DeadlineItem[];
  sources: SourceItem[];
  explicit_topics?: string[];
  eligibility_report?: EligibilityReportData;
  metadata?: Record<string, any>;
}


/** Score components shown to the user, in weight order. Components are 0-100; <0 means "not used". */
const COMPONENTS = [
  { keys: ['topic_similarity'], label: 'Topic similarity', weight: 45, desc: 'How close the call text is to your research summary.' },
  { keys: ['term_match'], label: 'Your keywords in the call', weight: 30, desc: 'Your topic, method and application terms found in the call text.' },
  { keys: ['deadline_actionability'], label: 'Time to apply', weight: 15, desc: 'Lower when the deadline has passed or is less than 14 days away.' },
  { keys: ['venue_or_funder_fit', 'venue_funder_fit'], label: 'Funder or venue fit', weight: 5, desc: 'Whether this funder or venue is one you listed in your profile.' },
  { keys: ['recency'], label: 'Recently announced', weight: 5, desc: 'Newly announced calls rank slightly higher.' }
];

function verdictBadge(verdict: string): { tone: Tone; text: string } {
  if (verdict === 'PASS') return { tone: 'success', text: 'Meets' };
  if (verdict === 'NEEDS_MANUAL_REVIEW') return { tone: 'warning', text: 'Check' };
  if (verdict === 'WARNING') return { tone: 'warning', text: 'Note' };
  return { tone: 'danger', text: 'Does not meet' };
}

const sentence = (s: string) => {
  const t = s.replace(/_/g, ' ').trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export default function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); // Next 15: params is a Promise
  const [opp, setOpp] = useState<OpportunityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [track, setTrack] = useState<TrackStatus>('new');
  const [trackError, setTrackError] = useState<string | null>(null);
  const [trackBusy, setTrackBusy] = useState(false);
  const [askingWhy, setAskingWhy] = useState(false);
  // What the last dismissal changed, for the confirmation line
  const [dismissedTopics, setDismissedTopics] = useState<string[] | null>(null);

  useEffect(() => {
    fetch(`/api/opportunities/${id}`)
      .then((res) => res.json())
      .then((data) => {
        const oppData = data?.data || data;
        if (oppData && !oppData.error && oppData.id) {
          setOpp(oppData);
          setTrack((TRACK_STATUSES as readonly string[]).includes(oppData.status) ? oppData.status : 'new');
        } else {
          setOpp(null);
        }
      })
      .catch(() => setOpp(null))
      .finally(() => setLoading(false));
  }, [id]);

  /** Optimistic status change; rolls back and explains if the server refuses. */
  const setStatus = async (next: TrackStatus, extra?: DismissChoice) => {
    const previous = track;
    setTrack(next);
    setTrackError(null);
    setTrackBusy(true);
    try {
      const res = await fetch(`/api/opportunities/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next, ...extra })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      setTrack(previous);
      setTrackError('Could not update this call. Check your connection and try again.');
    } finally {
      setTrackBusy(false);
    }
  };

  if (loading) {
    return (
      <Page>
        <Panel>
          <LoadingRows rows={4} label="Loading call" />
        </Panel>
      </Page>
    );
  }

  if (!opp) {
    return (
      <Page narrow>
        <Panel>
          <EmptyState
            icon="search_off"
            title="Call not found"
            action={
              <Link href="/" className={buttonClass('primary')}>
                Back to feed
              </Link>
            }
          >
            This call may have been removed, or the link is incomplete.
          </EmptyState>
        </Panel>
      </Page>
    );
  }

  const score = opp.score_explanation;
  const components = score?.components || {};
  const matchedTerms = score?.matched_terms || [];
  const negativeMatches = score?.negative_matches || [];
  const finalScore = score?.final_score ?? null;
  const band = score?.band ?? null;

  const primarySrc = opp.sources?.[0] ?? null;
  const officialUrl = safeExternalUrl(primarySrc?.source_url) || (opp.doi ? `https://doi.org/${encodeURIComponent(opp.doi)}` : undefined);
  const publisher = opp.agency_or_publisher || opp.venue_name || primarySrc?.source_name;
  const isAward =
    opp.kind === 'award' ||
    opp.metadata?.origin === 'nsf_awards_api' ||
    Boolean(primarySrc?.source_name?.toLowerCase().includes('award')) ||
    Boolean(opp.agency_or_publisher?.toLowerCase().includes('award'));
  const eligibility = eligibilityLabel(opp.eligibility_report);
  const datedDeadlines = [...opp.deadlines].sort((a, b) => (a.deadline_date ?? '9999').localeCompare(b.deadline_date ?? '9999'));
  const nextDeadline = datedDeadlines.find((d) => d.deadline_date && daysUntil(d.deadline_date) >= 0);
  const shareText = callShareText(
    {
      id: opp.id,
      title: opp.title,
      publisher,
      officialUrl,
      deadline: nextDeadline?.deadline_date ? { date: nextDeadline.deadline_date, daysLeft: daysUntil(nextDeadline.deadline_date) } : null
    },
    typeof window !== 'undefined' ? window.location.origin : undefined
  );

  const deadlinesPanel = (
    <Panel
      title="Deadlines"
      description="India time (IST)"
      actions={
        <a href="/api/deadlines?format=ics&mine=true" className="text-body-sm text-primary hover:underline underline-offset-4" title="Deadlines of calls you saved or are applying to">
          Add to calendar
        </a>
      }
    >
      {datedDeadlines.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">No dates found in this call. Check the official call page.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-outline-variant -my-3">
          {datedDeadlines.map((dl, i) => {
            const days = dl.deadline_date ? daysUntil(dl.deadline_date) : null;
            return (
              <li key={dl.id ?? i} className="py-3 flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-body-md font-semibold text-on-surface tabular-nums">
                    {dl.deadline_date ? formatDeadline(dl.deadline_date) : 'Rolling'}
                  </span>
                  {days !== null && (
                    <span className={`text-body-sm tabular-nums ${days >= 0 && days <= 7 ? 'text-error font-semibold' : 'text-on-surface-variant'}`}>
                      {days < 0 ? 'Passed' : days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'}`}
                    </span>
                  )}
                </div>
                <span className="text-body-sm text-on-surface-variant">{sentence(dl.deadline_type)}</span>
                {dl.confidence !== 'confirmed' && (
                  <span className="text-[12px] text-on-surface-variant">Read from the call document; confirm on the official page.</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );

  return (
    <Page>
      {/* Header */}
      <div className="flex flex-col gap-6">
        <Link href="/" className="self-start inline-flex items-center gap-1 min-h-11 -my-3 sm:min-h-0 sm:my-0 text-body-sm text-on-surface-variant hover:text-primary">
          <Icon name="arrow_back" className="text-[16px]" />
          Back to feed
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          <div className="lg:col-span-8 flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-body-sm">
              <span className="font-semibold text-primary">{isAward ? 'Past award' : kindName(opp.kind, opp.lifecycle_status)}</span>
              {publisher && <span className="text-on-surface-variant">{publisher}</span>}
              {opp.doi && <span className="text-on-surface-variant">DOI {opp.doi}</span>}
            </div>
            <h1 className="font-headline-xl text-headline-lg sm:text-headline-xl text-on-surface max-w-[30ch]">{opp.title}</h1>
            <p className="text-body-sm text-on-surface-variant">
              Found {opp.discovered_at ? formatIstDateTime(opp.discovered_at) : 'in the latest scan'}
              {primarySrc?.source_name ? ` on ${primarySrc.source_name}` : ''}
            </p>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {officialUrl && (
                <a href={officialUrl} target="_blank" rel="noreferrer" className={buttonClass('primary')}>
                  Open official call page
                  <Icon name="open_in_new" className="text-[16px]" />
                </a>
              )}
              {!isApplication(track) && (
                <>
                  <Button icon="flag" disabled={trackBusy} onClick={() => setStatus('pursuing')}>
                    I&apos;m applying
                  </Button>
                  <Button
                    variant="ghost"
                    icon={track === 'dismissed' ? 'undo' : 'visibility_off'}
                    aria-pressed={track === 'dismissed'}
                    disabled={trackBusy}
                    aria-expanded={track === 'dismissed' ? undefined : askingWhy}
                    onClick={() => (track === 'dismissed' ? setStatus('new') : setAskingWhy(true))}
                  >
                    {track === 'dismissed' ? 'Undo not relevant' : 'Not relevant'}
                  </Button>
                </>
              )}
              <SendToTelegram text={shareText} variant="ghost" />
            </div>
            <div aria-live="polite" className="text-body-sm">
              {trackError ? (
                <span className="text-error">{trackError}</span>
              ) : track === 'pursuing' ? (
                <span className="text-on-surface-variant">Added to your applications. Its deadlines are now in your reminders.</span>
              ) : track === 'dismissed' ? (
                <span className="text-on-surface-variant">
                  {dismissedTopics && dismissedTopics.length > 0
                    ? `Hidden from your feed. Calls about ${dismissedTopics.join(', ')} will rank a little lower.`
                    : 'Hidden from your feed. Your matches stay the same.'}
                </span>
              ) : null}
            </div>

            {askingWhy && track !== 'dismissed' && (
              <DismissPanel
                title={opp.title}
                busy={trackBusy}
                onCancel={() => setAskingWhy(false)}
                onConfirm={(choice) => {
                  setAskingWhy(false);
                  setDismissedTopics(choice.reason === PENALISING_REASON ? choice.negative_terms : []);
                  void setStatus('dismissed', choice);
                }}
              />
            )}

            {opp.eligibility_report && opp.eligibility_report.status !== 'ELIGIBLE' && (
              <Notice
                tone={eligibility.tone === 'danger' ? 'danger' : 'warning'}
                title={eligibility.text}
              >
                {opp.eligibility_report.summary}{' '}
                <a href="#eligibility" className="text-primary underline underline-offset-4">See why</a>
              </Notice>
            )}

            {isAward && (
              <Notice tone="info" title="This is a past award, not an open call">
                Use it to see what the programme funds and who it has funded.
              </Notice>
            )}
            {opp.lifecycle_status === 'closed' && (
              <Notice tone="neutral" title="This call has closed">
                Its deadline has passed. It is kept here for reference.
              </Notice>
            )}
            {opp.lifecycle_status === 'unknown' && opp.kind === 'funding' && (
              <Notice tone="warning" title="No deadline published yet">
                Check the official call page before you plan your application.
              </Notice>
            )}
          </div>

          {/* Score */}
          <aside className="lg:col-span-4 rounded-2xl surface-card bg-surface p-5 sm:p-6 flex flex-col gap-3" aria-label="Match score">
            <div className="flex items-end justify-between gap-4">
              <div className="flex flex-col">
                <span className="text-body-sm text-on-surface-variant">Match score</span>
                <span className={`text-[3.5rem] leading-none font-semibold tracking-[-0.04em] tabular-nums ${isGoodMatch(band) ? 'text-primary' : 'text-on-surface'}`}>
                  {finalScore === null ? '—' : Math.round(finalScore)}
                </span>
              </div>
              <span className={`text-body-md font-semibold ${bandTextClass(band)}`}>{bandLabel(band)}</span>
            </div>
            {finalScore !== null && <Meter value={finalScore} label="Match score out of 100" />}
            <p className="text-body-sm text-on-surface-variant">
              {matchedTerms.length > 0
                ? `Shares ${matchedTerms.length} of your keywords: ${matchedTerms.slice(0, 3).join(', ')}${matchedTerms.length > 3 ? '…' : ''}.`
                : finalScore === null
                  ? 'Scored on the next scan after you complete your profile.'
                  : 'Matched on the overall topic of your research summary.'}
            </p>
          </aside>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
        {/* Main column */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          {isApplication(track) && (
            <ApplicationPanel
              opportunityId={opp.id}
              status={track}
              initialNotes={opp.notes || ''}
              initialMyDeadline={opp.my_deadline ?? null}
              initialMyDeadlineLabel={opp.my_deadline_label || ''}
              onStatusChange={setStatus}
              onSaved={(fields) => setOpp((prev) => (prev ? { ...prev, ...fields } : prev))}
              busy={trackBusy}
            />
          )}
          <InstitutionNotePanel opportunityId={opp.id} />
          <div className="lg:hidden">{deadlinesPanel}</div>
          <Panel title="About this call">
            <div className="flex flex-col gap-4">
              <p className="text-body-md text-on-surface leading-relaxed max-w-[70ch] whitespace-pre-line">
                {opp.summary || 'No description was published with this call. See the official call page for details.'}
              </p>
              {opp.explicit_topics && opp.explicit_topics.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-body-sm font-semibold text-on-surface">Topics the call asks for</h3>
                  <ul className="flex flex-wrap gap-1.5">
                    {opp.explicit_topics.map((t) => (
                      <li key={t} className="rounded-full bg-surface-container px-2.5 py-0.5 text-body-sm text-on-surface">
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Panel>

          <Panel title="Why it matched" description="How the match score is built. Weights add up to 100.">
            <div className="flex flex-col gap-5">
              <ul className="flex flex-col gap-4">
                {COMPONENTS.map(({ keys, label, weight, desc }) => {
                  const raw = keys.map((k) => components[k]).find((v) => v !== undefined && v !== null);
                  const val = raw === undefined || raw < 0 ? null : Math.round(raw);
                  return (
                    <li key={label} className="flex flex-col gap-1.5">
                      <div className="flex items-baseline justify-between gap-3 text-body-sm">
                        <span className="text-on-surface font-semibold">
                          {label} <span className="font-normal text-on-surface-variant">· {weight}% of score</span>
                        </span>
                        <span className="tabular-nums text-on-surface">{val === null ? 'Not used' : `${val}/100`}</span>
                      </div>
                      <Meter value={val ?? 0} tone="success" label={`${label}: ${val ?? 0} out of 100`} />
                      <p className="text-body-sm text-on-surface-variant">{desc}</p>
                    </li>
                  );
                })}
                {components.feedback_penalty !== undefined && components.feedback_penalty > 0 && (
                  <li className="flex items-baseline justify-between gap-3 text-body-sm">
                    <span className="text-on-surface">
                      <span className="font-semibold">Lowered by your feedback</span>
                      <span className="text-on-surface-variant"> · similar to calls you marked not relevant</span>
                    </span>
                    <span className="tabular-nums text-error font-semibold">−{Math.round(components.feedback_penalty)}</span>
                  </li>
                )}
              </ul>

              <div className="flex flex-col gap-2 pt-4 border-t border-outline-variant">
                <h3 className="text-body-sm font-semibold text-on-surface">Keywords in common</h3>
                {matchedTerms.length === 0 && negativeMatches.length === 0 ? (
                  <p className="text-body-sm text-on-surface-variant">None of your keywords appear word for word; the match comes from the overall topic.</p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {matchedTerms.map((t) => (
                      <li key={`m-${t}`}>
                        <Badge tone="info" icon="check">{t}</Badge>
                      </li>
                    ))}
                    {negativeMatches.map((t) => (
                      <li key={`n-${t}`}>
                        <Badge tone="danger" icon="block">{t} (excluded)</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {score?.model_version && <p className="text-[12px] text-on-surface-variant">Scoring model {score.model_version}</p>}
            </div>
          </Panel>

          <Panel id="eligibility" title="Eligibility" actions={<Badge tone={eligibility.tone}>{eligibility.text}</Badge>}>
            <div className="flex flex-col gap-4">
              <p className="text-body-md text-on-surface max-w-[70ch]">
                {opp.eligibility_report?.summary || (
                  <>
                    Not checked against your profile yet. It is checked on the next scan once your{' '}
                    <Link href="/profile" className="text-primary underline underline-offset-4">
                      eligibility details
                    </Link>{' '}
                    are filled in. Until then, check eligibility on the official call page.
                  </>
                )}
              </p>
              {(opp.eligibility_report?.checks ?? []).length > 0 && (
                <ul className="flex flex-col divide-y divide-outline-variant border-y border-outline-variant">
                  {opp.eligibility_report!.checks.map((chk, i) => {
                    const v = verdictBadge(chk.verdict);
                    return (
                      <li key={i} className="py-3 flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-body-sm font-semibold text-on-surface">{sentence(chk.rule_name)}</span>
                          <Badge tone={v.tone}>{v.text}</Badge>
                        </div>
                        <p className="text-body-sm text-on-surface-variant">{chk.reason}</p>
                        {chk.solicitation_excerpt && (
                          <blockquote className="text-body-sm text-on-surface-variant border-l-2 border-outline-variant pl-3 italic">
                            {chk.solicitation_excerpt}
                          </blockquote>
                        )}
                        <EligibilityCorrection
                          opportunityId={opp.id}
                          ruleName={chk.rule_name}
                          verdict={chk.verdict}
                          excerpt={chk.solicitation_excerpt}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
              {opp.eligibility_report?.action_items && opp.eligibility_report.action_items.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-body-sm font-semibold text-on-surface">Before you apply</h3>
                  <ul className="list-disc pl-5 text-body-sm text-on-surface-variant space-y-1">
                    {opp.eligibility_report.action_items.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Panel>
        </div>

        {/* Side column */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="hidden lg:block">{deadlinesPanel}</div>

          {opp.sources.length > 0 && (
            <Panel title="Where we found it">
              <ul className="flex flex-col divide-y divide-outline-variant -my-3">
                {opp.sources.map((src, i) => {
                  const href = safeExternalUrl(src.source_url);
                  return (
                    <li key={i} className="py-3 flex flex-col gap-0.5">
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer" className="text-body-md font-semibold text-on-surface hover:text-primary inline-flex items-center gap-1">
                          {src.source_name}
                          <Icon name="open_in_new" className="text-[14px] text-on-surface-variant" />
                        </a>
                      ) : (
                        <span className="text-body-md font-semibold text-on-surface">{src.source_name}</span>
                      )}
                      {src.first_seen_at && <span className="text-body-sm text-on-surface-variant">First seen {formatIstDateTime(src.first_seen_at)}</span>}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </Page>
  );
}
