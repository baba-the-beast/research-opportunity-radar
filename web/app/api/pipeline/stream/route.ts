import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { consumeRateLimit, rateLimitKey } from '@/lib/rateLimit';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { getActivePipelineLock } from '@/lib/pipelineLock';
import { createErrorResponse } from '@/lib/apiResponse';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  const searchParams = req.nextUrl.searchParams;
  const triggerRun = searchParams.get('run') === 'true' || searchParams.get('trigger') === '1';
  const isDryRun = searchParams.get('dry_run') === 'true' || searchParams.get('dryRun') === '1';
  const suppressAlerts = searchParams.get('suppress_alerts') === 'true' || searchParams.get('suppressAlerts') === '1';

  if (triggerRun) {
    // 1. Authentication & Authorization
    const auth = await authenticateRequest(req);
    if (!auth.authenticated) {
      return auth.errorResponse!;
    }
    const roleCheck = authorizeRole(auth.user, ['operator', 'admin']);
    if (!roleCheck.authorized) {
      return roleCheck.errorResponse!;
    }

    // 2. Sanitized IP Rate limit check (max 5 triggered runs per 10 minutes)
    const ip = rateLimitKey(req, auth.user);
    const rateCheck = await consumeRateLimit(`stream_${ip}`, 5, 600000);
    if (!rateCheck.allowed) {
      return createErrorResponse(
        'RATE_LIMIT_EXCEEDED',
        'Rate limit exceeded: Too many pipeline execution requests.',
        429,
        req
      );
    }

    // 3. Fail fast if a run is in progress. The spawned Python process takes the real lease
    // (radar_pipeline_global) and reports a clean ABORT event if it loses a race.
    let active;
    try {
      active = await getActivePipelineLock();
    } catch (err: any) {
      return createErrorResponse('DATABASE_ERROR', `Could not check pipeline status: ${err.message}`, 503, req);
    }
    if (active) {
      return createErrorResponse(
        'PIPELINE_CONCURRENCY_CONFLICT',
        `Pipeline execution already active by '${active.lockedBy}'. Wait for current execution to conclude.`,
        409,
        req
      );
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      let clientGone = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const stopHeartbeat = () => {
        if (heartbeat) clearInterval(heartbeat);
      };
      const sendEvent = (data: Record<string, any>) => {
        if (clientGone) return;
        try {
          const text = `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(text));
        } catch {
          // stream controller might already be closed
        }
      };

      if (!triggerRun) {
        // Honest idle state when no pipeline scan is requested
        sendEvent({
          phase: 'IDLE',
          agent: 'Orchestrator',
          level: 'INFO',
          stepIndex: 1,
          message: 'Observatory Standing Watch online. Trigger "Rescan Corpus" to execute live multi-agent discovery cycle.',
          timestamp: new Date().toISOString()
        });
        controller.close();
        return;
      }

      sendEvent({
        phase: 'INIT',
        agent: 'Orchestrator',
        level: 'INFO',
        stepIndex: 1,
        message: `Spawning live multi-agent pipeline process (DiscoveryAgent + EligibilityAgent + Scorer) [dry_run=${isDryRun}, suppress_alerts=${suppressAlerts}]...`,
        timestamp: new Date().toISOString()
      });

      // Resolve repository root containing radar/
      let projectRoot = path.resolve(process.cwd(), '..');
      if (fs.existsSync(path.resolve(process.cwd(), 'radar'))) {
        projectRoot = process.cwd();
      } else if (process.env.PROJECT_ROOT && fs.existsSync(process.env.PROJECT_ROOT)) {
        projectRoot = process.env.PROJECT_ROOT;
      }

      const args = ['-m', 'radar.orchestrator.pipeline', '--stream'];
      if (isDryRun) {
        args.push('--dry-run');
      }
      if (suppressAlerts) {
        args.push('--suppress-alerts');
      }

      const pyProc = spawn('python', args, {
        cwd: projectRoot,
        env: {
          ...process.env,
          PYTHONPATH: projectRoot,
          PYTHONUNBUFFERED: '1'
        }
      });

      // SSE comment heartbeat: keeps proxies from closing a quiet stream (model loading can be
      // silent for a while) and lets the client use an idle timeout instead of a total one.
      heartbeat = setInterval(() => {
        if (clientGone) return stopHeartbeat();
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          stopHeartbeat();
        }
      }, 15_000);

      let stdoutBuffer = '';

      pyProc.stdout.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString('utf-8');
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith('TELEMETRY_EVENT:')) {
            try {
              const eventPayload = JSON.parse(trimmed.slice('TELEMETRY_EVENT:'.length));
              sendEvent(eventPayload);
            } catch {
              sendEvent({
                phase: 'STREAM',
                agent: 'Runtime',
                level: 'TRACE',
                message: trimmed,
                timestamp: new Date().toISOString()
              });
            }
          } else if (trimmed.startsWith('Running radar pipeline') || trimmed.startsWith('Pipeline finished')) {
            sendEvent({
              phase: 'LIFECYCLE',
              agent: 'Orchestrator',
              level: 'INFO',
              message: trimmed,
              timestamp: new Date().toISOString()
            });
          }
        }
      });

      pyProc.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8').trim();
        if (text && !text.includes('Loading weights') && !text.includes('HF_TOKEN')) {
          sendEvent({
            phase: 'SYSTEM',
            agent: 'Stderr',
            level: 'WARN',
            message: text.slice(0, 300),
            timestamp: new Date().toISOString()
          });
        }
      });

      pyProc.on('close', (code) => {
        stopHeartbeat();
        if (code === 0) {
          sendEvent({
            phase: 'COMPLETE',
            agent: 'Orchestrator',
            level: 'SUCCESS',
            stepIndex: 4,
            message: 'Pipeline execution finished successfully with exit code 0.',
            timestamp: new Date().toISOString()
          });
        } else {
          sendEvent({
            phase: 'ERROR',
            agent: 'Orchestrator',
            level: 'ERROR',
            message: `Pipeline process exited with code ${code}.`,
            timestamp: new Date().toISOString()
          });
        }
        if (!clientGone) controller.close();
      });

      pyProc.on('error', (err) => {
        stopHeartbeat();
        sendEvent({
          phase: 'ERROR',
          agent: 'Orchestrator',
          level: 'ERROR',
          message: `Failed to spawn Python process: ${err.message}`,
          timestamp: new Date().toISOString()
        });
        if (!clientGone) controller.close();
      });

      // Closing the tab only stops the event stream. The pipeline keeps running to completion
      // (killing it mid-run would abandon half-written DB state and a held lease).
      req.signal.addEventListener('abort', () => {
        clientGone = true;
        stopHeartbeat();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
}
