/**
 * Opportunity sources a user can choose in Settings. Mirrors SOURCE_NAMES / DEFAULT_SOURCES in
 * radar/config.py: `id` is stored in user_preferences.preferred_sources, `sourceName` is the
 * opportunity's source name.
 */
export interface SourceOption {
  id: string;
  label: string;
  description: string;
  region: 'india' | 'global' | 'us';
}

export const SOURCE_OPTIONS: SourceOption[] = [
  { id: 'ANRF', label: 'ANRF (formerly SERB)', description: 'Core, early-career and mission research grants; fellowships', region: 'india' },
  { id: 'DST', label: 'DST', description: 'Department of Science & Technology calls for proposals', region: 'india' },
  { id: 'DBT', label: 'DBT', description: 'Department of Biotechnology calls for proposals', region: 'india' },
  { id: 'ICMR', label: 'ICMR / DHR', description: 'Medical and health research calls', region: 'india' },
  { id: 'BIRAC', label: 'BIRAC', description: 'Biotech innovation and translational calls (academia and start-ups)', region: 'india' },
  { id: 'CSIR', label: 'CSIR (HRDG)', description: 'Extramural research, Emeritus Scientist and special research-grant calls', region: 'india' },
  { id: 'ICSSR', label: 'ICSSR', description: 'Social science research projects, fellowships and journal calls', region: 'india' },
  { id: 'MeitY', label: 'MeitY', description: 'Electronics and IT research and development calls', region: 'india' },
  { id: 'MoES', label: 'MoES', description: 'Earth, ocean, polar and climate science calls', region: 'india' },
  { id: 'UGC', label: 'UGC', description: 'Research awards, fellowships and international programmes for universities', region: 'india' },
  { id: 'AICTE', label: 'AICTE', description: 'Fellowships and schemes for technical institutions', region: 'india' },
  { id: 'INSA', label: 'INSA', description: 'Indian National Science Academy fellowships, lectures and research calls', region: 'india' },
  { id: 'DRDO', label: 'DRDO', description: 'Defence research calls for academic institutions', region: 'india' },
  { id: 'CEFIPRA', label: 'CEFIPRA', description: 'Indo-French research projects and mobility fellowships', region: 'india' },
  { id: 'WikiCFP', label: 'Calls for papers', description: 'Conference, workshop and journal special-issue deadlines (WikiCFP)', region: 'global' },
  { id: 'Grants.gov', label: 'Grants.gov', description: 'US federal grants (most need a US institution)', region: 'us' },
  { id: 'NSF', label: 'NSF', description: 'US National Science Foundation solicitations', region: 'us' }
];

export const SOURCE_IDS = SOURCE_OPTIONS.map((s) => s.id) as [string, ...string[]];

export const DEFAULT_SOURCES = ['ANRF', 'DST', 'DBT', 'ICMR', 'BIRAC', 'CSIR', 'ICSSR', 'MeitY', 'MoES', 'UGC', 'AICTE', 'INSA', 'DRDO', 'CEFIPRA', 'WikiCFP'];

/** The defaults before Oct 2026 (radar/config.py LEGACY_DEFAULT_SOURCES). */
const LEGACY_DEFAULT_SOURCES = ['ANRF', 'DST', 'DBT', 'ICMR', 'BIRAC', 'CSIR', 'ICSSR', 'WikiCFP'];

/**
 * A saved source choice plus funders added to the defaults since, unless the user had turned a
 * default off (then their choice is kept exactly). Mirrors with_new_defaults() in radar/config.py.
 */
export function withNewDefaults(saved: string[]): string[] {
  if (!LEGACY_DEFAULT_SOURCES.every((s) => saved.includes(s))) return saved;
  return [...saved, ...DEFAULT_SOURCES.filter((s) => !saved.includes(s))];
}
