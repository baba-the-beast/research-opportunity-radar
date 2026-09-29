import { NextRequest } from 'next/server';
import { getOwnProfileId, getRequestSupabase } from '@/lib/routeContext';
import { authenticateRequest } from '@/lib/auth';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';
import { daysUntil, formatDeadline, formatIstDateTime, istDate } from '@/lib/dates';

export const dynamic = 'force-dynamic';

const BAND_RANK: Record<string, number> = { low: 0, watch: 1, strong: 2, high: 3 };

/**
 * The caller's digest for the latest scan: opportunities first scored for them in that run,
 * best first, marked with whether they pass the user's digest filters (band and minimum score).
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated) {
      return auth.errorResponse!;
    }
    const supabase = getRequestSupabase(auth.user);

    const { data: runs, error: runErr } = await supabase
      .from('run_log')
      .select('id, status, started_at, finished_at, opportunities_found, opportunities_new')
      // partial_failure runs still ingest and write opportunities
      .in('status', ['success', 'partial_failure'])
      .order('started_at', { ascending: false })
      .limit(1);
    if (runErr) {
      return createErrorResponse('DATABASE_ERROR', runErr.message, 500, req);
    }
    const run = runs?.[0] ?? null;

    const profileId = await getOwnProfileId(supabase, auth.user);
    if (!run || !profileId) {
      return createSuccessResponse({ run, items: [], markdown: '', needs_profile: !profileId }, req);
    }

    const { data: profile } = await supabase.from('faculty_profile').select('min_relevance_band').eq('id', profileId).single();
    const { data: prefs } = auth.user?.isServiceRole
      ? { data: null }
      : await supabase.from('user_preferences').select('min_score').eq('user_id', auth.user?.id ?? '').maybeSingle();
    const minBand = profile?.min_relevance_band || 'watch';
    const minScore = prefs?.min_score ?? 50;

    const { data: scores, error: scoreErr } = await supabase
      .from('scoring_log')
      .select('final_score, band, matched_terms, opportunities!inner(id, title, kind, agency_or_publisher, venue_name, status, opportunity_deadlines(deadline_date, confidence), opportunity_sources(source_url))')
      .eq('faculty_id', profileId)
      .gte('scored_at', run.started_at)
      .order('final_score', { ascending: false })
      .limit(50);
    if (scoreErr) {
      return createErrorResponse('DATABASE_ERROR', scoreErr.message, 500, req);
    }

    const today = istDate();
    const seen = new Set<string>();
    const items = (scores || [])
      .map((row: any) => {
        const opp = Array.isArray(row.opportunities) ? row.opportunities[0] : row.opportunities;
        const upcoming = (opp?.opportunity_deadlines || [])
          .filter((d: any) => d.deadline_date && d.deadline_date >= today)
          .sort((a: any, b: any) => a.deadline_date.localeCompare(b.deadline_date))[0];
        return {
          id: opp?.id,
          title: opp?.title,
          kind: opp?.kind,
          agency: opp?.agency_or_publisher || opp?.venue_name || '',
          url: opp?.opportunity_sources?.[0]?.source_url || null,
          score: Math.round(Number(row.final_score)),
          band: row.band,
          matched_terms: row.matched_terms || [],
          deadline: upcoming ? { date: upcoming.deadline_date, days_left: daysUntil(upcoming.deadline_date, today) } : null,
          in_digest: (BAND_RANK[row.band] ?? -1) >= (BAND_RANK[minBand] ?? 1) && Number(row.final_score) >= minScore
        };
      })
      // Rescoring after a profile edit can add a second row for the same opportunity
      .filter((item) => item.id && item.band !== 'not_eligible' && !seen.has(item.id) && seen.add(item.id));

    const digestItems = items.filter((i) => i.in_digest);
    const markdown = [
      `# Research opportunity digest`,
      `Scan of ${run.finished_at ? formatIstDateTime(run.finished_at) : 'the latest run'}`,
      '',
      ...(digestItems.length
        ? digestItems.map(
            (i, n) =>
              `${n + 1}. **${i.title}** (${i.agency || i.kind}), score ${i.score}` +
              (i.deadline ? `, due ${formatDeadline(i.deadline.date)}` : ', deadline not published') +
              (i.url ? `\n   ${i.url}` : '')
          )
        : ['No new calls passed your digest filters in this scan.'])
    ].join('\n');

    return createSuccessResponse({ run, min_band: minBand, min_score: minScore, items, markdown }, req);
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
