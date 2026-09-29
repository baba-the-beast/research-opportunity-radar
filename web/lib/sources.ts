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
  { id: 'WikiCFP', label: 'Calls for papers', description: 'Conference, workshop and journal special-issue deadlines (WikiCFP)', region: 'global' },
  { id: 'Grants.gov', label: 'Grants.gov', description: 'US federal grants (most need a US institution)', region: 'us' },
  { id: 'NSF', label: 'NSF', description: 'US National Science Foundation solicitations', region: 'us' }
];

export const SOURCE_IDS = SOURCE_OPTIONS.map((s) => s.id) as [string, ...string[]];

export const DEFAULT_SOURCES = ['ANRF', 'DST', 'DBT', 'ICMR', 'BIRAC', 'CSIR', 'ICSSR', 'WikiCFP'];
