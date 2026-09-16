import { getSupabaseAdminClient, isSupabaseConfigured } from './supabaseServerClient';

interface LockRecord {
  lock_key: string;
  locked_by: string;
  expires_at: string;
}

// In-memory fallback for test / local standalone environments
const inMemoryLocks = new Map<string, { locked_by: string; expires_at: number }>();

/**
 * Attempts to acquire a database-backed distributed lock with lease expiration.
 * Prevents concurrent overlapping pipeline executions across processes and hosts.
 */
export async function acquirePipelineLock(
  lockKey: string = 'pipeline_main',
  lockedBy: string = 'worker',
  ttlSeconds: number = 900
): Promise<{ acquired: boolean; currentHolder?: string; expiresAt?: string }> {
  const now = Date.now();
  const expiresAtMs = now + ttlSeconds * 1000;
  const expiresAtIso = new Date(expiresAtMs).toISOString();

  if (!isSupabaseConfigured()) {
    const existing = inMemoryLocks.get(lockKey);
    if (existing && existing.expires_at > now) {
      return {
        acquired: false,
        currentHolder: existing.locked_by,
        expiresAt: new Date(existing.expires_at).toISOString()
      };
    }
    inMemoryLocks.set(lockKey, { locked_by: lockedBy, expires_at: expiresAtMs });
    return { acquired: true, currentHolder: lockedBy, expiresAt: expiresAtIso };
  }

  try {
    const supabase = getSupabaseAdminClient();

    // 1. Inspect existing lock
    const { data: existing } = await supabase
      .from('pipeline_locks')
      .select('*')
      .eq('lock_key', lockKey)
      .single();

    if (existing && new Date(existing.expires_at).getTime() > now) {
      return {
        acquired: false,
        currentHolder: existing.locked_by,
        expiresAt: existing.expires_at
      };
    }

    // 2. Insert or update expired lease
    const { error } = await supabase
      .from('pipeline_locks')
      .upsert({
        lock_key: lockKey,
        locked_at: new Date(now).toISOString(),
        locked_by: lockedBy,
        expires_at: expiresAtIso
      }, { onConflict: 'lock_key' });

    if (error) {
      return { acquired: false, currentHolder: 'unknown' };
    }

    return { acquired: true, currentHolder: lockedBy, expiresAt: expiresAtIso };
  } catch {
    return { acquired: false, currentHolder: 'db_error' };
  }
}

/**
 * Releases the distributed lock when pipeline execution concludes.
 */
export async function releasePipelineLock(
  lockKey: string = 'pipeline_main',
  lockedBy: string = 'worker'
): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    const existing = inMemoryLocks.get(lockKey);
    if (existing && existing.locked_by === lockedBy) {
      inMemoryLocks.delete(lockKey);
      return true;
    }
    return false;
  }

  try {
    const supabase = getSupabaseAdminClient();
    await supabase
      .from('pipeline_locks')
      .delete()
      .eq('lock_key', lockKey)
      .eq('locked_by', lockedBy);
    return true;
  } catch (err) {
    console.error(`Failed to release pipeline lock '${lockKey}':`, err);
    return false;
  }
}
