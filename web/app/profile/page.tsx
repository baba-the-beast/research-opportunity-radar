'use client';

import { useEffect, useState } from 'react';

interface ProfileTermItem {
  term: string;
  term_type: 'topic' | 'method' | 'application' | 'venue' | 'funding_theme';
  weight: number;
  polarity: 'positive' | 'negative';
}

const EMPTY_PROFILE = {
  id: null as string | null,
  full_name: '',
  institution: '',
  department: '',
  designation: '',
  employment_type: '',
  date_of_birth: '',
  superannuation_year: null as number | null,
  state: '',
  phd_year: null as number | null,
  institution_type: '',
  citizenship_status: '',
  research_keywords: [] as string[],
  profile_text: '',
  min_relevance_band: 'watch',
  deadline_alert_window_days: 30,
  profile_terms: [] as ProfileTermItem[]
};

const DESIGNATIONS = [
  'Assistant Professor',
  'Associate Professor',
  'Professor',
  'Scientist / Research Scientist',
  'Postdoctoral / Research Fellow',
  'Other'
];

const INSTITUTION_TYPES = [
  'IIT / NIT / IISER / IIIT / IISc',
  'Central University',
  'State University',
  'Deemed / Private University',
  'Affiliated College',
  'National Lab / Research Institute (CSIR, ICMR, DRDO, ...)',
  'Institution outside India'
];

const CITIZENSHIP = ['Indian citizen', 'OCI / PIO card holder', 'Foreign national', 'US Citizen or Permanent Resident'];

const STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Outside India'
];

function keywordsFromText(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<any>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [keywordsText, setKeywordsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [newTerm, setNewTerm] = useState('');
  const [newType, setNewType] = useState<'topic' | 'method' | 'application' | 'venue' | 'funding_theme'>('topic');
  const [minBand, setMinBand] = useState('watch');
  const [alertWindow, setAlertWindow] = useState(30);
  const [orcidInput, setOrcidInput] = useState('');
  const [fetchingOrcid, setFetchingOrcid] = useState(false);
  const [orcidMessage, setOrcidMessage] = useState<string | null>(null);

  const handleOrcidFetch = async () => {
    if (!orcidInput.trim()) return;
    setFetchingOrcid(true);
    setOrcidMessage(null);
    try {
      const res = await fetch(`/api/profile/orcid?orcid=${encodeURIComponent(orcidInput.trim())}`);
      const data = await res.json();
      if (!res.ok) {
        setOrcidMessage(`Error: ${data.error || 'Failed to import ORCID profile'}`);
        return;
      }

      setProfile((prev: any) => ({
        ...prev,
        full_name: data.full_name || prev.full_name,
        institution: data.institution || prev.institution,
        department: data.department || prev.department,
        designation: prev.designation || (data.career_stage === 'early_career' ? 'Assistant Professor' : data.career_stage === 'senior' ? 'Professor' : 'Associate Professor'),
        phd_year: data.phd_year || prev.phd_year,
        research_keywords: data.keywords && data.keywords.length > 0 ? data.keywords : prev.research_keywords,
        profile_text: data.profile_text || prev.profile_text,
        profile_terms: data.candidate_terms && data.candidate_terms.length > 0 ? data.candidate_terms : prev.profile_terms,
        orcid: data.orcid
      }));
      if (data.keywords?.length) setKeywordsText(data.keywords.join(', '));
      setOrcidMessage(`Successfully imported ${data.full_name || 'researcher'} (${data.works_count || 0} works, ${data.candidate_terms?.length || 0} candidate terms extracted). Review and click Save.`);
    } catch (err: any) {
      setOrcidMessage(`Network error: ${err.message}`);
    } finally {
      setFetchingOrcid(false);
    }
  };

  useEffect(() => {
    fetch('/api/profile')
      .then((res) => res.json())
      .then((data) => {
        const prof = data?.data || data;
        if (prof && !prof.error) {
          setProfile({ ...EMPTY_PROFILE, ...prof, profile_terms: prof.profile_terms || [] });
          setKeywordsText((prof.research_keywords || []).join(', '));
          if (prof.min_relevance_band) setMinBand(prof.min_relevance_band);
          if (prof.deadline_alert_window_days) setAlertWindow(prof.deadline_alert_window_days);
        }
      })
      .catch(() => setSaveMessage({ ok: false, text: 'Could not load your profile. Refresh to try again.' }))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    const keywords = keywordsFromText(keywordsText);
    const missing = [
      !profile.full_name?.trim() && 'name',
      !profile.institution?.trim() && 'institution',
      keywords.length === 0 && 'research keywords',
      !profile.profile_text?.trim() && 'research summary'
    ].filter(Boolean);
    if (missing.length) {
      setSaveMessage({ ok: false, text: `Please fill in: ${missing.join(', ')}.` });
      return;
    }
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: profile.full_name,
          institution: profile.institution,
          department: profile.department || '',
          designation: profile.designation || '',
          career_stage: profile.designation || '',
          employment_type: profile.employment_type || '',
          date_of_birth: profile.date_of_birth || '',
          superannuation_year: profile.superannuation_year ? Number(profile.superannuation_year) : null,
          state: profile.state || '',
          phd_year: profile.phd_year ? Number(profile.phd_year) : null,
          institution_type: profile.institution_type || '',
          citizenship_status: profile.citizenship_status || '',
          min_relevance_band: minBand,
          deadline_alert_window_days: alertWindow,
          research_keywords: keywords,
          profile_text: profile.profile_text,
          profile_terms: profile.profile_terms || []
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = body?.error?.message || body?.message || `HTTP ${res.status}`;
        setSaveMessage({ ok: false, text: `Not saved: ${detail}` });
        return;
      }
      setProfile((prev: any) => ({ ...prev, id: body?.data?.profile_id || prev.id, research_keywords: keywords }));
      setSaveMessage({ ok: true, text: 'Saved. Scores are recalculated on the next scan.' });
    } catch (err: any) {
      setSaveMessage({ ok: false, text: `Not saved: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  const addTerm = () => {
    if (!newTerm.trim()) return;
    const updatedTerms = [
      ...(profile.profile_terms || []),
      { term: newTerm.trim(), term_type: newType, weight: 0.9, polarity: 'positive' }
    ];
    setProfile({ ...profile, profile_terms: updatedTerms });
    setNewTerm('');
  };

  const removeTerm = (index: number) => {
    const updated = (profile.profile_terms || []).filter((_: any, i: number) => i !== index);
    setProfile({ ...profile, profile_terms: updated });
  };

  const togglePolarity = (index: number) => {
    const updated = [...(profile.profile_terms || [])];
    updated[index].polarity = updated[index].polarity === 'positive' ? 'negative' : 'positive';
    setProfile({ ...profile, profile_terms: updated });
  };

  if (loading) {
    return (
      <div className="p-16 text-center font-data-mono-sm text-data-mono-sm text-on-surface-variant">
        Loading your profile...
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-space-md sm:px-space-xl py-space-md sm:py-space-xl space-y-space-xl sm:space-y-space-2xl">
      {/* Header Block: Instrument Status & Telemetry Meta */}
      <div className="flex flex-col gap-space-xs pb-space-md sm:pb-space-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-xs">
          <div className="flex items-center gap-space-sm font-data-mono-sm text-data-mono-sm text-on-surface-variant tracking-wider uppercase">
            <span className="w-2 h-2 bg-primary-container inline-block"></span>
            <span>Calibration Console // Engine Heuristics &amp; Weights</span>
          </div>
          <div className="font-data-mono-sm text-data-mono-sm text-on-surface-variant flex items-center gap-space-sm sm:gap-space-md flex-wrap">
            <span>{profile.id ? 'Profile saved' : 'New profile: not saved yet'}</span>
          </div>
        </div>
        <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight">Faculty Calibration &amp; Scoring Heuristics</h1>
        <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
          Your research interests decide which calls are shown to you and how they are ranked. The eligibility details let the radar flag calls you cannot apply for (age limits, regular posts, region-only calls). Leave a field empty if you prefer; those calls are then marked for manual review.
        </p>
      </div>

      {/* ORCID Assisted Profile Setup Bar */}
      <div className="bg-surface-container border border-surface-container-high p-space-md flex flex-col gap-space-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-space-md">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="font-label-caps text-label-caps text-secondary uppercase font-bold tracking-wider">
                ORCID-Assisted Profile Setup
              </span>
              <span className="font-data-mono-xs text-data-mono-xs px-1.5 py-0.5 border border-secondary/30 text-secondary bg-secondary/10">
                AUTO-CALIBRATION
              </span>
            </div>
            <p className="font-data-mono-sm text-data-mono-sm text-on-surface-variant">
              Enter public 16-digit ORCID iD to pre-fill researcher identity, affiliation, recent works, and candidate terms.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
            <input
              type="text"
              placeholder="0000-0002-1825-0097"
              value={orcidInput}
              onChange={(e) => setOrcidInput(e.target.value)}
              className="bg-surface-container-lowest border border-surface-container-high px-space-sm py-1.5 font-data-mono-sm text-data-mono-sm text-on-surface focus:outline-none focus:border-secondary w-full sm:w-64"
            />
            <button
              onClick={handleOrcidFetch}
              disabled={fetchingOrcid || !orcidInput.trim()}
              className="px-space-md py-1.5 bg-secondary-container text-on-secondary font-label-caps text-label-caps uppercase tracking-wider hover:bg-secondary transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
            >
              {fetchingOrcid ? 'Importing...' : 'Fetch ORCID'}
            </button>
          </div>
        </div>
        {orcidMessage && (
          <div className={`p-space-sm border font-data-mono-sm text-data-mono-sm ${orcidMessage.startsWith('Error') ? 'border-error text-error bg-error/10' : 'border-secondary text-secondary bg-secondary/10'}`}>
            {orcidMessage}
          </div>
        )}
      </div>

      {/* Section 1: Faculty & Affiliation */}
      <section className="bg-surface-container-low p-space-md sm:p-space-xl flex flex-col gap-space-md sm:gap-space-lg border border-surface-container">
        <div className="flex items-center justify-between pb-space-xs">
          <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">Section 01 // Identity &amp; Primary Record</span>
          <span className="font-data-mono-md text-data-mono-md text-primary-container">{profile.id ? '' : 'Start here'}</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md sm:gap-space-xl">
          {/* Faculty Name */}
          <div className="flex flex-col gap-space-2xs group">
            <label className="font-data-mono-sm text-data-mono-sm text-on-surface-variant uppercase tracking-wider">Faculty Investigator</label>
            <input
              className="bg-transparent font-headline-md text-headline-md text-on-surface py-space-xs focus:outline-none focus:text-primary transition-colors cursor-text"
              type="text"
              placeholder="Your name"
              value={profile.full_name || ''}
              onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
            />
            <span className="h-px bg-outline-variant group-focus-within:bg-primary-container transition-colors"></span>
          </div>
          {/* Academic Institution */}
          <div className="flex flex-col gap-space-2xs group">
            <label className="font-data-mono-sm text-data-mono-sm text-on-surface-variant uppercase tracking-wider">Academic Institution</label>
            <input
              className="bg-transparent font-headline-md text-headline-md text-on-surface py-space-xs focus:outline-none focus:text-primary transition-colors cursor-text"
              type="text"
              placeholder="Institution"
              value={profile.institution || ''}
              onChange={(e) => setProfile({ ...profile, institution: e.target.value })}
            />
            <span className="h-px bg-outline-variant group-focus-within:bg-primary-container transition-colors"></span>
          </div>
          {/* Department Affiliation */}
          <div className="flex flex-col gap-space-2xs group">
            <label className="font-data-mono-sm text-data-mono-sm text-on-surface-variant uppercase tracking-wider">Division / Department</label>
            <input
              className="bg-transparent font-headline-md text-headline-md text-on-surface py-space-xs focus:outline-none focus:text-primary transition-colors cursor-text"
              type="text"
              placeholder="Department"
              value={profile.department || ''}
              onChange={(e) => setProfile({ ...profile, department: e.target.value })}
            />
            <span className="h-px bg-outline-variant group-focus-within:bg-primary-container transition-colors"></span>
          </div>
        </div>

        {/* Section 01B: Eligibility details */}
        <div className="border-t border-surface-container pt-space-md">
          <div className="mb-space-sm">
            <span className="font-label-caps text-label-caps text-primary uppercase tracking-wider">Eligibility details</span>
            <p className="text-on-surface-variant text-xs font-mono">Used to check restrictions stated in each call: nationality, age limit, years to superannuation, regular post, region-only calls and years since PhD.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-space-md sm:gap-space-lg">
            <div className="flex flex-col gap-space-2xs">
              <label className="font-data-mono-sm text-data-mono-sm text-on-surface-variant uppercase">Designation</label>
              <select
                className="bg-surface-container font-mono text-sm text-on-surface p-2 border border-surface-container-high focus:outline-none focus:border-primary rounded"
                value={profile.designation || ''}
                onChange={(e) => setProfile({ ...profile, designation: e.target.value })}
              >
                <option value="">Not set</option>
                {DESIGNATIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-space-2xs">
              <label className="font-data-mono-sm text-data-mono-sm text-on-surface-variant uppercase">Position</label>
              <select
                className="bg-surface-container font-mono text-sm text-on-surface p-2 border border-surface-container-high focus:outline-none focus:border-primary rounded"
                value={profile.employment_type || ''}
                onChange={(e) => setProfile({ ...profile, employment_type: e.target.value })}
              >
                <option value="">Not set</option>
                <option value="regular">Regular / permanent</option>
                <option value="contractual">Contractual / ad hoc</option>
              </select>
            </div>
            <div className="flex flex-col gap-space-2xs">
              <label className="font-data-mono-sm text-data-mono-sm text-on-surface-variant uppercase">Institution type</label>
              <select
                className="bg-surface-container font-mono text-sm text-on-surface p-2 border border-surface-container-high focus:outline-none focus:border-primary rounded"
                value={profile.institution_type || ''}
                onChange={(e) => setProfile({ ...profile, institution_type: e.target.value })}
              >
                <option value="">Not set</option>
                {INSTITUTION_TYPES.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-space-2xs">
              <label className="font-data-mono-sm text-data-mono-sm text-on-surface-variant uppercase">Citizenship</label>
              <select
                className="bg-surface-container font-mono text-sm text-on-surface p-2 border border-surface-container-high focus:outline-none focus:border-primary rounded"
                value={profile.citizenship_status || ''}
                onChange={(e) => setProfile({ ...profile, citizenship_status: e.target.value })}
              >
                <option value="">Not set</option>
                {CITIZENSHIP.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-space-2xs">
              <label className="font-data-mono-sm text-data-mono-sm text-on-surface-variant uppercase">State / UT of institution</label>
              <select
                className="bg-surface-container font-mono text-sm text-on-surface p-2 border border-surface-container-high focus:outline-none focus:border-primary rounded"
                value={profile.state || ''}
                onChange={(e) => setProfile({ ...profile, state: e.target.value })}
              >
                <option value="">Not set</option>
                {STATES.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-space-2xs">
              <label className="font-data-mono-sm text-data-mono-sm text-on-surface-variant uppercase">Date of birth</label>
              <input
                className="bg-surface-container font-mono text-sm text-on-surface p-2 border border-surface-container-high focus:outline-none focus:border-primary rounded"
                type="date"
                value={profile.date_of_birth || ''}
                onChange={(e) => setProfile({ ...profile, date_of_birth: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-space-2xs">
              <label className="font-data-mono-sm text-data-mono-sm text-on-surface-variant uppercase">PhD year</label>
              <input
                className="bg-surface-container font-mono text-sm text-on-surface p-2 border border-surface-container-high focus:outline-none focus:border-primary rounded"
                type="number"
                min={1950}
                max={new Date().getFullYear()}
                placeholder="e.g. 2015"
                value={profile.phd_year ?? ''}
                onChange={(e) => setProfile({ ...profile, phd_year: e.target.value ? parseInt(e.target.value, 10) : null })}
              />
            </div>
            <div className="flex flex-col gap-space-2xs">
              <label className="font-data-mono-sm text-data-mono-sm text-on-surface-variant uppercase">Superannuation (retirement) year</label>
              <input
                className="bg-surface-container font-mono text-sm text-on-surface p-2 border border-surface-container-high focus:outline-none focus:border-primary rounded"
                type="number"
                min={new Date().getFullYear()}
                max={2100}
                placeholder="e.g. 2045"
                value={profile.superannuation_year ?? ''}
                onChange={(e) => setProfile({ ...profile, superannuation_year: e.target.value ? parseInt(e.target.value, 10) : null })}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Research Keywords & Profile Text */}
      <section className="bg-surface-container-low p-space-md sm:p-space-xl flex flex-col gap-space-md sm:gap-space-lg border border-surface-container">
        <div className="flex items-center justify-between pb-space-xs">
          <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">Section 02 // Semantic Persona &amp; Research Dossier</span>
          <span className="font-data-mono-sm text-data-mono-sm text-primary">VECTOR CORRELATOR: ACTIVE</span>
        </div>
        <div className="flex flex-col gap-space-xs">
          <label className="font-data-mono-sm text-data-mono-sm text-on-surface-variant uppercase">Research keywords</label>
          <p className="font-body-sm text-body-sm text-on-surface-variant">Comma-separated. Each keyword is searched for calls for papers, so be specific (e.g. &quot;graph neural networks&quot; rather than &quot;AI&quot;).</p>
          <input
            className="w-full bg-surface-container-lowest p-space-sm font-body-md text-body-md text-on-surface border border-outline-variant focus:outline-none focus:border-primary"
            type="text"
            placeholder="e.g. graph neural networks, fraud detection, edge AI"
            value={keywordsText}
            onChange={(e) => setKeywordsText(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-space-xs">
          <label className="font-data-mono-sm text-data-mono-sm text-on-surface-variant uppercase">Research summary</label>
          <p className="font-body-sm text-body-sm text-on-surface-variant">A few sentences about your research. Calls are ranked by how similar their text is to this summary.</p>
        </div>
        <div className="relative group">
          <textarea
            className="w-full bg-surface-container-lowest p-space-md font-body-md text-body-md text-on-surface border border-outline-variant focus:outline-none focus:border-primary transition-colors leading-relaxed"
            rows={4}
            placeholder="e.g. I work on graph neural networks for detecting financial fraud, with a focus on explainability and deployment on edge devices."
            value={profile.profile_text || ''}
            onChange={(e) => setProfile({ ...profile, profile_text: e.target.value })}
          />
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-outline-variant group-focus-within:bg-primary-container transition-colors"></div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 font-data-mono-sm text-data-mono-sm text-on-surface-variant pt-space-2xs">
          <span className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-[14px] text-secondary">memory</span>
            Vector re-indexing: continuous
          </span>
          <span className="text-on-surface-variant">Embedding: all-MiniLM-L6-v2 (384-dim)</span>
        </div>
      </section>

      {/* Section 3: Weighted Terms & Heuristic Calibration */}
      <section className="bg-surface-container-low p-space-md sm:p-space-xl flex flex-col gap-space-md sm:gap-space-lg border border-surface-container">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-space-xs gap-space-xs">
          <div className="flex flex-col">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">Section 03 // Weighted Terms (Vocabulary &amp; Calibration)</span>
            <span className="font-body-sm text-body-sm text-on-surface-variant">Explicit term penalties and coefficients applied during post-vector rank arbitration.</span>
          </div>
          <div className="font-data-mono-sm text-data-mono-sm text-on-surface-variant">
            ACTIVE VOCABULARY: <span className="text-on-surface font-bold">{(profile.profile_terms || []).length} ITEMS</span>
          </div>
        </div>

        {/* Mobile Term Cards (Stitch profile_mobile.html pattern) */}
        <div className="md:hidden flex flex-col gap-2">
          {(profile.profile_terms || []).map((t: ProfileTermItem, idx: number) => (
            <div
              key={idx}
              className="bg-surface-container p-space-sm rounded flex items-center justify-between gap-space-sm border border-surface-container-high"
            >
              <div className="flex items-center gap-space-sm min-w-0">
                <button
                  type="button"
                  onClick={() => togglePolarity(idx)}
                  className={`px-space-xs py-space-2xs font-data-mono-sm text-data-mono-sm rounded uppercase font-bold shrink-0 ${
                    t.polarity === 'negative'
                      ? 'bg-error-container text-on-error-container'
                      : 'bg-secondary-container text-on-secondary-container'
                  }`}
                >
                  {t.polarity === 'negative' ? '- NEG' : '+ POS'}
                </button>
                <div className="flex flex-col min-w-0">
                  <span className="font-headline-sm text-headline-sm text-on-surface truncate">{t.term}</span>
                  <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant uppercase">
                    Domain: {t.term_type}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-space-sm shrink-0">
                <span className={`font-data-mono-lg text-data-mono-lg font-bold ${t.polarity === 'negative' ? 'text-rust' : 'text-secondary'}`}>
                  {(t.weight || 1.0).toFixed(2)}
                </span>
                <button
                  className="text-on-surface-variant hover:text-error transition-colors p-1"
                  type="button"
                  onClick={() => removeTerm(idx)}
                  title="Remove term"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop Ledger Table */}
        <div className="hidden md:block w-full overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-lowest text-on-surface-variant font-data-mono-sm text-data-mono-sm uppercase tracking-wider">
                <th className="py-space-sm px-space-md font-normal">Term Lexicon</th>
                <th className="py-space-sm px-space-md font-normal">Category</th>
                <th className="py-space-sm px-space-md font-normal w-56">Weight Coefficient</th>
                <th className="py-space-sm px-space-md font-normal text-right">Polarity</th>
                <th className="py-space-sm px-space-md font-normal text-right w-16">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y-0 text-on-surface font-body-md text-body-md">
              {(profile.profile_terms || []).map((t: ProfileTermItem, idx: number) => (
                <tr key={idx} className={`hover:bg-surface-container-high/60 transition-colors group ${t.polarity === 'negative' ? 'bg-error-container/10' : ''}`}>
                  <td className={`py-space-sm px-space-md font-headline-md text-headline-md ${t.polarity === 'negative' ? 'text-tertiary' : 'text-on-surface'}`}>{t.term}</td>
                  <td className="py-space-sm px-space-md">
                    <span className="inline-flex items-center px-space-xs py-0.5 font-data-mono-sm text-data-mono-sm uppercase tracking-wider bg-surface-container text-on-surface-variant">{t.term_type}</span>
                  </td>
                  <td className="py-space-sm px-space-md">
                    <div className="flex items-center gap-space-md">
                      <div className="flex-1 bg-surface-container-highest h-1.5 overflow-hidden">
                        <div className={`h-full ${t.polarity === 'negative' ? 'bg-tertiary-container' : 'bg-primary-container'}`} style={{ width: `${(t.weight || 1.0) * 100}%` }}></div>
                      </div>
                      <span className={`font-data-mono-md text-data-mono-md font-bold ${t.polarity === 'negative' ? 'text-tertiary' : 'text-primary'}`}>{(t.weight || 1.0).toFixed(2)}</span>
                    </div>
                  </td>
                  <td className="py-space-sm px-space-md text-right">
                    <button
                      className={`inline-flex items-center gap-space-2xs px-space-xs py-0.5 font-data-mono-sm text-data-mono-sm font-bold tracking-wider uppercase transition-colors ${
                        t.polarity === 'negative'
                          ? 'bg-on-tertiary-container/40 text-tertiary hover:bg-on-tertiary-container/60'
                          : 'bg-secondary-container/30 text-secondary hover:bg-secondary-container/50'
                      }`}
                      type="button"
                      onClick={() => togglePolarity(idx)}
                    >
                      <span className="material-symbols-outlined text-[13px]">{t.polarity === 'negative' ? 'remove' : 'add'}</span> {t.polarity === 'negative' ? 'NEGATIVE' : 'POSITIVE'}
                    </button>
                  </td>
                  <td className="py-space-sm px-space-md text-right">
                    <button className="text-on-surface-variant hover:text-error transition-colors" type="button" onClick={() => removeTerm(idx)}>
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add Term Input Row */}
        <div className="flex flex-col sm:flex-row gap-space-sm sm:gap-space-md pt-space-xs">
          <input
            className="flex-1 bg-surface-container-lowest p-space-sm font-body-md text-body-md text-on-surface border border-outline-variant focus:outline-none focus:border-primary"
            type="text"
            placeholder="Add new research term..."
            value={newTerm}
            onChange={(e) => setNewTerm(e.target.value)}
          />
          <select
            className="bg-surface-container-lowest p-space-sm font-data-mono-sm text-data-mono-sm text-on-surface border border-outline-variant focus:outline-none focus:border-primary"
            value={newType}
            onChange={(e: any) => setNewType(e.target.value)}
          >
            <option value="topic">topic</option>
            <option value="method">method</option>
            <option value="application">application</option>
            <option value="venue">venue</option>
            <option value="funding_theme">funding_theme</option>
          </select>
          <button
            className="inline-flex items-center justify-center gap-space-xs font-data-mono-sm text-data-mono-sm text-primary hover:text-primary-fixed transition-colors underline decoration-dashed underline-offset-4 decoration-outline-variant hover:decoration-primary py-1 sm:py-0"
            type="button"
            onClick={addTerm}
          >
            <span className="material-symbols-outlined text-[14px]">add_circle</span>
            <span>APPEND TERM</span>
          </button>
        </div>
      </section>

      {/* Section 4: Alert Thresholds & Radar Window */}
      <section className="bg-surface-container-low p-space-xl flex flex-col gap-space-xl">
        <div className="flex flex-col">
          <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">Section 04 // Telemetry Filters &amp; Observation Windows</span>
          <span className="font-body-sm text-body-sm text-on-surface-variant">Gate triggers for surfacing opportunities to main observation ledger and notification relays.</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-space-xl">
          {/* Threshold 1: Minimum Feed Band */}
          <div className="flex flex-col gap-space-md bg-surface-container-lowest p-space-lg">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant uppercase tracking-wider">Minimum Band Cutoff</span>
                <span className="font-headline-sm text-headline-sm text-on-surface">Radar Feed Admission</span>
              </div>
              <span className="font-data-mono-lg text-data-mono-lg text-primary bg-surface-container px-space-sm py-0.5">{minBand.toUpperCase()}</span>
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Digests include new calls at this band or above. HIGH sends only the closest matches; WATCH sends more.
            </p>
            {/* Precision Discrete Selector */}
            <div className="grid grid-cols-4 gap-space-2xs pt-space-xs font-data-mono-sm text-data-mono-sm">
              {['high', 'strong', 'watch', 'low'].map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setMinBand(b)}
                  className={`py-space-xs px-space-2xs text-center transition-colors ${
                    minBand === b ? 'bg-primary-container text-on-primary-container font-bold' : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {b.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          {/* Threshold 2: Deadline Alert Horizon */}
          <div className="flex flex-col gap-space-md bg-surface-container-lowest p-space-lg">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant uppercase tracking-wider">Temporal Boundary</span>
                <span className="font-headline-sm text-headline-sm text-on-surface">Deadline Alert Horizon</span>
              </div>
              <span className="font-data-mono-lg text-data-mono-lg text-secondary bg-surface-container px-space-sm py-0.5">{alertWindow} DAYS</span>
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Deadlines within this many days are highlighted in your deadlines view. Urgent alerts are always sent 3 days before a deadline of a call you saved or that scored highly.
            </p>
            {/* Stepper Options */}
            <div className="grid grid-cols-4 gap-space-2xs pt-space-xs font-data-mono-sm text-data-mono-sm">
              {[30, 60, 90, 180].map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setAlertWindow(days)}
                  className={`py-space-xs px-space-2xs text-center transition-colors ${
                    alertWindow === days ? 'bg-secondary-container text-secondary font-bold' : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {days} DAYS
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Bottom Actions Toolbar */}
      <div className="flex items-center justify-between pt-space-md pb-space-2xl">
        <div className="flex items-center gap-space-sm font-data-mono-sm text-data-mono-sm" role="status" aria-live="polite">
          {saveMessage && (
            <span className={saveMessage.ok ? 'text-secondary' : 'text-error'}>{saveMessage.text}</span>
          )}
        </div>
        <div className="flex items-center gap-space-lg">
          <button
            className="font-body-md text-body-md text-on-surface-variant hover:text-on-surface transition-colors uppercase tracking-wider font-data-mono-sm text-data-mono-sm"
            type="button"
            onClick={() => window.location.reload()}
          >
            Discard Changes
          </button>
          <button
            className="inline-flex items-center gap-space-sm px-space-lg py-space-sm bg-secondary-container text-secondary hover:bg-secondary-container/80 transition-colors font-data-mono-sm text-data-mono-sm font-bold uppercase tracking-wider"
            type="button"
            disabled={saving}
            onClick={handleSave}
          >
            <span className="material-symbols-outlined text-[16px]">tune</span>
            <span>{saving ? 'Saving...' : 'Save profile'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
