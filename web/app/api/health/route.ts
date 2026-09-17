import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Canonical lightweight health endpoint for external watchdogs and keep-alive monitors.
 * Purely in-memory: does not perform DB queries, ML inference, or external API calls.
 * Always returns HTTP 200 OK when the web application is running.
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'research-opportunity-radar',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    uptime_seconds: Math.floor(process.uptime())
  });
}
