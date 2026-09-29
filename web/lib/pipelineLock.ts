import { getSupabaseAdminClient, isSupabaseConfigured } from './supabaseServerClient';

/**
 * Lease key taken by the Python orchestrator (radar/orchestrator/pipeline.py). The Python process
 * owns the lock for the whole run, whether it was started by cron, GitHub Actions, or the stream
 * route, so the web tier only reads it to fail fast instead of taking a second, uncoordinated lock.
 */
export const PIPELINE_LOCK_KEY = 'radar_pipeline_global';

export interface ActivePipelineLock {
  lockedBy: string;
  expiresAt: string;
}

/** The unexpired lease on the pipeline, or null if no run is in progress. */
export async function getActivePipelineLock(
  lockKey: string = PIPELINE_LOCK_KEY
): Promise<ActivePipelineLock | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('pipeline_locks')
    .select('locked_by, expires_at')
    .eq('lock_key', lockKey)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error) {
    throw new Error(`pipeline_locks lookup failed: ${error.message}`);
  }
  return data ? { lockedBy: data.locked_by, expiresAt: data.expires_at } : null;
}
