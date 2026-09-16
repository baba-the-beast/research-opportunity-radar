import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Liveness probe: Confirms the Next.js process is active and responsive.
 * Does not check external dependencies to avoid cascading restart storms.
 */
export async function GET() {
  return NextResponse.json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    service: 'research-opportunity-radar'
  });
}
