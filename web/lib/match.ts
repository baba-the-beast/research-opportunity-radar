/** Match bands, best first. One source for labels, cut-offs and colour across every page. */
export const BANDS = [
  { key: 'high', label: 'High', cutoff: '80+' },
  { key: 'strong', label: 'Strong', cutoff: '65+' },
  { key: 'watch', label: 'Watch', cutoff: '50+' },
  { key: 'low', label: 'Low', cutoff: 'under 50' }
] as const;

export type BandKey = (typeof BANDS)[number]['key'];

/** 0 = best. Unknown bands sort last. */
export const BAND_RANK: Record<string, number> = { high: 0, strong: 1, watch: 2, low: 3 };

export function bandLabel(band: string | null | undefined): string {
  const b = BANDS.find((x) => x.key === band);
  return b ? `${b.label} match` : 'Not scored';
}

/** Text colour for a band label: green for good matches, amber for watch, muted otherwise. */
export function bandTextClass(band: string | null | undefined): string {
  if (band === 'high' || band === 'strong') return 'text-secondary';
  if (band === 'watch') return 'text-tertiary';
  return 'text-on-surface-variant';
}

export function isGoodMatch(band: string | null | undefined): boolean {
  return band === 'high' || band === 'strong';
}

/** Plain-language name for an opportunity kind. */
export function kindName(kind: string, lifecycle?: string): string {
  if (kind === 'journal') return 'Journal call for papers';
  if (kind === 'venue') return 'Conference call for papers';
  if (kind === 'award') return 'Past award';
  if (lifecycle === 'forecasted') return 'Funding call, opens soon';
  return 'Funding call';
}
