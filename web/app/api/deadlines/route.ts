import { NextRequest, NextResponse } from 'next/server';
import { getRequestSupabase, UUID_PATTERN } from '@/lib/routeContext';
import { authenticateRequest } from '@/lib/auth';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';
import { daysUntil, istDate } from '@/lib/dates';

export const dynamic = 'force-dynamic';

const ICS_LIMIT = 200;

function icsEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** All-day events, one per deadline; UIDs are stable so re-importing updates instead of duplicating. */
function buildIcs(items: any[]): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Research Opportunity Radar//Deadlines//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Research deadlines',
    'X-WR-TIMEZONE:Asia/Kolkata'
  ];
  for (const item of items) {
    const day = item.deadline_date.replace(/-/g, '');
    const [y, m, d] = item.deadline_date.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10).replace(/-/g, '');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${item.opportunity_id}-${item.deadline_type}@research-opportunity-radar`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day}`,
      `DTEND;VALUE=DATE:${next}`,
      `SUMMARY:${icsEscape(`Deadline: ${item.title}`)}`,
      `DESCRIPTION:${icsEscape(
        [item.agency, `Deadline (${item.deadline_type.replace(/_/g, ' ')}), India time.`, item.confidence === 'probable' ? 'Date read from the call document; confirm on the official page.' : '', item.source_url]
          .filter(Boolean)
          .join('\n')
      )}`,
      ...(item.source_url ? [`URL:${item.source_url}`] : []),
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated) {
      return auth.errorResponse!;
    }

    const searchParams = req.nextUrl.searchParams;
    const asIcs = searchParams.get('format') === 'ics';
    const limitParam = parseInt(searchParams.get('limit') || '20', 10);
    const limit = asIcs ? ICS_LIMIT : Math.max(1, Math.min(isNaN(limitParam) ? 20 : limitParam, 50));
    // Keyset cursor "<deadline_date>|<id>": the id tiebreak keeps deadlines that share a date
    // from being skipped at a page boundary. A bare date is accepted for old clients.
    const rawCursor = searchParams.get('cursor');
    const [cursorDate, cursorId] = rawCursor ? rawCursor.split('|') : [];
    if (rawCursor && (!/^\d{4}-\d{2}-\d{2}$/.test(cursorDate) || (cursorId !== undefined && !UUID_PATTERN.test(cursorId)))) {
      return createErrorResponse('VALIDATION_ERROR', 'Invalid pagination cursor', 400, req);
    }
    const includePast = searchParams.get('include_past') === 'true';
    // mine=true: only calls the user saved or is pursuing/applying to
    const mineOnly = searchParams.get('mine') === 'true';
    const today = istDate();

    const supabase = getRequestSupabase(auth.user);
    const userId = auth.user?.isServiceRole ? null : auth.user?.id;

    let trackedIds: string[] | null = null;
    if (mineOnly) {
      if (!userId) {
        trackedIds = [];
      } else {
        const { data: states, error: stErr } = await supabase
          .from('user_opportunity_state')
          .select('opportunity_id, saved, status')
          .eq('user_id', userId);
        if (stErr) {
          return createErrorResponse('DATABASE_ERROR', stErr.message, 500, req);
        }
        trackedIds = (states || [])
          .filter((s: any) => s.saved || s.status === 'pursuing' || s.status === 'applied')
          .map((s: any) => s.opportunity_id);
      }
      if (trackedIds.length === 0) {
        return asIcs
          ? new NextResponse(buildIcs([]), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="research-deadlines.ics"' } })
          : createSuccessResponse({ data: [], pagination: { limit, next_cursor: null, has_more: false } }, req);
      }
    }

    let query = supabase
      .from('opportunity_deadlines')
      .select('id, deadline_type, deadline_date, confidence, timezone, opportunities!inner(id, title, kind, agency_or_publisher, venue_name, status, opportunity_sources(source_url))')
      .order('deadline_date', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit + 1);

    if (!includePast) {
      query = query.gte('deadline_date', today);
    }
    if (trackedIds) {
      query = query.in('opportunity_id', trackedIds);
    }
    if (rawCursor) {
      query = cursorId
        ? query.or(`deadline_date.gt.${cursorDate},and(deadline_date.eq.${cursorDate},id.gt.${cursorId})`)
        : query.gt('deadline_date', cursorDate);
    }

    const { data: dls, error } = await query;
    if (error) {
      return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
    }

    const rows: any[] = dls || [];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && lastRow ? `${lastRow.deadline_date}|${lastRow.id}` : null;

    const formatted = pageRows.map((row: any) => {
      const opp = Array.isArray(row.opportunities) ? row.opportunities[0] : row.opportunities;
      return {
        id: row.id,
        opportunity_id: opp?.id,
        title: opp?.title || 'Untitled',
        kind: opp?.kind || 'funding',
        agency: opp?.agency_or_publisher || opp?.venue_name || '',
        deadline_type: row.deadline_type,
        deadline_date: row.deadline_date,
        days_left: daysUntil(row.deadline_date, today),
        timezone: row.timezone || 'Asia/Kolkata',
        confidence: row.confidence,
        source_url: opp?.opportunity_sources?.[0]?.source_url || null
      };
    });

    if (asIcs) {
      return new NextResponse(buildIcs(formatted), {
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Content-Disposition': 'attachment; filename="research-deadlines.ics"',
          'Cache-Control': 'no-store'
        }
      });
    }

    if (searchParams.get('format') === 'array') {
      return NextResponse.json(formatted);
    }

    return createSuccessResponse(
      {
        data: formatted,
        pagination: { limit, next_cursor: nextCursor, has_more: hasMore }
      },
      req
    );
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
