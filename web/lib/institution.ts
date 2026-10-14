/** Same normalisation as public.institution_key() (migration 20261013000200) and radar.db.client.institution_key. */
export function institutionKey(name: string | null | undefined): string {
  return (name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}
