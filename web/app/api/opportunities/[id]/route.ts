import { NextRequest } from 'next/server';
import { getOwnProfileId, getRequestSupabase, UUID_PATTERN } from '@/lib/routeContext';
import { authenticateRequest } from '@/lib/auth';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated) {
      return auth.errorResponse!;
    }

    const id = params?.id?.trim();
    if (!id || !UUID_PATTERN.test(id)) {
      return createErrorResponse('INVALID_IDENTIFIER', 'Invalid opportunity identifier format', 400, req);
    }

    const supabase = getRequestSupabase(auth.user);
    const userId = auth.user?.isServiceRole ? null : auth.user?.id;
    const profileId = await getOwnProfileId(supabase, auth.user);

    const { data: row, error } = await supabase
      .from('opportunities')
      .select(`
        *,
        opportunity_deadlines (*),
        opportunity_sources (*, sources(name))
      `)
      .eq('id', id)
      .single();

    if (error || !row) {
      return createErrorResponse('NOT_FOUND', 'Opportunity not found', 404, req);
    }

    // This faculty member's latest score (scoring_log is append-only and per faculty)
    let scoringRow: any = null;
    if (profileId) {
      const { data: scores, error: scoreErr } = await supabase
        .from('scoring_log')
        .select('*')
        .eq('opportunity_id', id)
        .eq('faculty_id', profileId)
        .order('scored_at', { ascending: false })
        .limit(1);
      if (scoreErr) {
        return createErrorResponse('DATABASE_ERROR', scoreErr.message, 500, req);
      }
      scoringRow = scores?.[0] ?? null;
    }

    let userStatus = 'new';
    if (userId) {
      const { data: state } = await supabase
        .from('user_opportunity_state')
        .select('status')
        .eq('user_id', userId)
        .eq('opportunity_id', id)
        .maybeSingle();
      userStatus = state?.status || 'new';
    }

    const { eligibility_report: eligibilityReport = null, ...components } = scoringRow?.components || {};
    const scoring = scoringRow || {
      final_score: null,
      band: 'unscored',
      matched_terms: [],
      negative_matches: []
    };
    // Legacy rows stored the seed profile's eligibility verdict in the shared metadata; never expose it
    const { eligibility_report: _legacyEligibility, ...publicMetadata } = row.metadata || {};

    return createSuccessResponse(
      {
        id: row.id,
        kind: row.kind,
        title: row.title,
        summary: row.summary,
        agency_or_publisher: row.agency_or_publisher,
        venue_name: row.venue_name,
        doi: row.doi,
        status: userStatus,
        // The call itself: open / forecasted / closed / unknown (no published deadline)
        lifecycle_status: row.status,
        discovered_at: row.discovered_at,
        deadlines: row.opportunity_deadlines || [],
        sources: (row.opportunity_sources || []).map((s: any) => ({
          source_name: s.sources?.name || 'Unknown',
          source_url: s.source_url,
          first_seen_at: s.first_seen_at,
          last_seen_at: s.last_seen_at
        })),
        score_explanation: {
          model_version: scoring.model_version || 'component-v1',
          final_score: scoring.final_score,
          band: scoring.band,
          components,
          matched_terms: scoring.matched_terms || [],
          negative_matches: scoring.negative_matches || [],
          eligibility: {
            status: scoring.band === 'unscored' ? 'unknown' : scoring.band !== 'not_eligible' ? 'eligible' : 'ineligible',
            confidence: eligibilityReport?.confidence ?? null
          }
        },
        eligibility_report: eligibilityReport,
        metadata: publicMetadata
      },
      req
    );
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
