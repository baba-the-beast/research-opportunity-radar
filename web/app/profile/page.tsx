'use client';

import { useEffect, useState } from 'react';

interface ProfileTermItem {
  term: string;
  term_type: 'topic' | 'method' | 'application' | 'venue' | 'funding_theme';
  weight: number;
  polarity: 'positive' | 'negative';
}

const DEFAULT_PROFILE = {
  full_name: 'Dr. Vibha',
  institution: 'COEP Technological University',
  department: 'Dept. of Computer Engineering',
  career_stage: 'Assistant Professor',
  phd_year: 2021,
  institution_type: 'R1 Doctoral University (IHE)',
  citizenship_status: 'US Citizen or Permanent Resident',
  research_keywords: ['graph neural networks', 'fraud detection', 'edge AI', 'cyber-physical systems', 'sensor fusion'],
  profile_text: 'Research focused on graph neural networks, financial fraud detection models, deterministic inference, distributed consensus, and edge AI sensor fusion in resource-constrained cyber-physical systems.',
  min_relevance_band: 'watch',
  profile_terms: [
    { term: 'sensor fusion', term_type: 'method' as const, weight: 0.95, polarity: 'positive' as const },
    { term: 'cyber-physical systems', term_type: 'topic' as const, weight: 0.90, polarity: 'positive' as const },
    { term: 'edge AI', term_type: 'application' as const, weight: 0.85, polarity: 'positive' as const },
    { term: 'autonomous systems', term_type: 'topic' as const, weight: 0.80, polarity: 'positive' as const },
    { term: 'cryptocurrency', term_type: 'topic' as const, weight: 0.75, polarity: 'negative' as const },
    { term: 'survey / review', term_type: 'venue' as const, weight: 0.60, polarity: 'negative' as const }
  ]
};

export default function ProfilePage() {
  const [profile, setProfile] = useState<any>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(false);
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
        career_stage: data.career_stage === 'early_career' ? 'Assistant Professor' : (data.career_stage === 'senior' ? 'Full Professor' : 'Associate Professor'),
        phd_year: data.phd_year || prev.phd_year,
        research_keywords: data.keywords && data.keywords.length > 0 ? data.keywords : prev.research_keywords,
        profile_text: data.profile_text || prev.profile_text,
        profile_terms: data.candidate_terms && data.candidate_terms.length > 0 ? data.candidate_terms : prev.profile_terms,
        orcid: data.orcid
      }));
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
        if (data && !data.error && data.full_name) {
          setProfile({
            ...DEFAULT_PROFILE,
            ...data,
            profile_terms: data.profile_terms && data.profile_terms.length > 0 ? data.profile_terms : DEFAULT_PROFILE.profile_terms
          });
          if (data.min_relevance_band) setMinBand(data.min_relevance_band);
        }
      })
      .catch(() => {
        // Retain default profile state
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: profile.full_name,
        institution: profile.institution,
        department: profile.department,
        career_stage: profile.career_stage,
        phd_year: Number(profile.phd_year),
        institution_type: profile.institution_type,
        citizenship_status: profile.citizenship_status,
        research_keywords: profile.research_keywords,
        profile_text: profile.profile_text,
        profile_terms: profile.profile_terms || []
      })
    });
    setSaving(false);
    alert('Faculty Calibration & Scoring Heuristics synchronized.');
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
        SYNCHRONIZING CALIBRATION HEURISTICS...
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-space-xl py-space-xl space-y-space-2xl">
      {/* Header Block: Instrument Status & Telemetry Meta */}
      <div className="flex flex-col gap-space-xs pb-space-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-space-sm font-data-mono-sm text-data-mono-sm text-on-surface-variant tracking-wider uppercase">
            <span className="w-2 h-2 bg-primary-container inline-block"></span>
            <span>Calibration Console // Engine Heuristics &amp; Weights</span>
          </div>
          <div className="font-data-mono-sm text-data-mono-sm text-on-surface-variant flex items-center gap-space-md">
            <span>MODEL: VECTOR-EMBED-v4.2</span>
            <span className="text-secondary font-bold">STATE: SYNCHRONIZED</span>
          </div>
        </div>
        <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight">Faculty Calibration &amp; Scoring Heuristics</h1>
        <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
          Adjust semantic parameters, lexical term weights, and scoring thresholds. Changes directly recalculate relevance vectors across all ingested solicitations in the active observation radar.
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
          <div className="flex items-center gap-2 w-full sm:w-auto">
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
      <section className="bg-surface-container-low p-space-xl flex flex-col gap-space-lg">
        <div className="flex items-center justify-between pb-space-xs">
          <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">Section 01 // Identity &amp; Primary Record</span>
          <span className="font-data-mono-md text-data-mono-md text-primary-container">#9104-ASTRO</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-space-xl">
          {/* Faculty Name */}
          <div className="flex flex-col gap-space-2xs group">
            <label className="font-data-mono-sm text-data-mono-sm text-on-surface-variant uppercase tracking-wider">Faculty Investigator</label>
            <input
              className="bg-transparent font-headline-md text-headline-md text-on-surface py-space-xs focus:outline-none focus:text-primary transition-colors cursor-text"
              type="text"
              value={profile.full_name || 'Dr. Vibha'}
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
              value={profile.institution || 'COEP Technological University'}
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
              value={profile.department || 'Dept. of Computer Engineering'}
              onChange={(e) => setProfile({ ...profile, department: e.target.value })}
            />
            <span className="h-px bg-outline-variant group-focus-within:bg-primary-container transition-colors"></span>
          </div>
        </div>

        {/* Section 01B: Compliance & Gatekeeper Credentials */}
        <div className="border-t border-surface-container pt-space-md">
          <div className="mb-space-sm">
            <span className="font-label-caps text-label-caps text-primary uppercase tracking-wider">Compliance &amp; Gatekeeper Vector</span>
            <p className="text-on-surface-variant text-xs font-mono">Parameters evaluated by EligibilityAgent to verify early-career tenure clock, citizenship restrictions, and institutional quotas.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-space-lg">
            {/* Career Stage */}
            <div className="flex flex-col gap-space-2xs">
              <label className="font-data-mono-sm text-data-mono-sm text-on-surface-variant uppercase">Career Stage</label>
              <select
                className="bg-surface-container font-mono text-sm text-on-surface p-2 border border-surface-container-high focus:outline-none focus:border-primary rounded"
                value={profile.career_stage || 'Assistant Professor'}
                onChange={(e) => setProfile({ ...profile, career_stage: e.target.value })}
              >
                <option value="Assistant Professor">Assistant Professor (Tenure-Track)</option>
                <option value="Associate Professor">Associate Professor (Tenured)</option>
                <option value="Full Professor">Full Professor (Tenured)</option>
                <option value="Postdoctoral Researcher">Postdoctoral Researcher</option>
                <option value="Research Scientist">Research Scientist</option>
              </select>
            </div>
            {/* PhD Award Year */}
            <div className="flex flex-col gap-space-2xs">
              <label className="font-data-mono-sm text-data-mono-sm text-on-surface-variant uppercase">PhD Award Year</label>
              <input
                className="bg-surface-container font-mono text-sm text-on-surface p-2 border border-surface-container-high focus:outline-none focus:border-primary rounded"
                type="number"
                min={1970}
                max={2030}
                value={profile.phd_year || 2021}
                onChange={(e) => setProfile({ ...profile, phd_year: parseInt(e.target.value) || 2021 })}
              />
            </div>
            {/* Institution Classification */}
            <div className="flex flex-col gap-space-2xs">
              <label className="font-data-mono-sm text-data-mono-sm text-on-surface-variant uppercase">Institution Type</label>
              <select
                className="bg-surface-container font-mono text-sm text-on-surface p-2 border border-surface-container-high focus:outline-none focus:border-primary rounded"
                value={profile.institution_type || 'R1 Doctoral University (IHE)'}
                onChange={(e) => setProfile({ ...profile, institution_type: e.target.value })}
              >
                <option value="R1 Doctoral University (IHE)">R1 Doctoral University (IHE)</option>
                <option value="R2 Doctoral University">R2 Doctoral University</option>
                <option value="Master's College/University">Master&apos;s College/University</option>
                <option value="Primarily Undergraduate Institution (PUI)">Primarily Undergraduate Institution (PUI)</option>
                <option value="National Laboratory / Research Institute">National Laboratory / Research Institute</option>
              </select>
            </div>
            {/* Citizenship Status */}
            <div className="flex flex-col gap-space-2xs">
              <label className="font-data-mono-sm text-data-mono-sm text-on-surface-variant uppercase">Citizenship / Clearance</label>
              <select
                className="bg-surface-container font-mono text-sm text-on-surface p-2 border border-surface-container-high focus:outline-none focus:border-primary rounded"
                value={profile.citizenship_status || 'US Citizen or Permanent Resident'}
                onChange={(e) => setProfile({ ...profile, citizenship_status: e.target.value })}
              >
                <option value="US Citizen or Permanent Resident">US Citizen or Permanent Resident</option>
                <option value="Non-US Citizen / Work Visa Eligible">Non-US Citizen / Work Visa Eligible</option>
                <option value="Foreign National">Foreign National</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Research Profile Semantic Base */}
      <section className="bg-surface-container-low p-space-xl flex flex-col gap-space-md">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">Section 02 // Research Profile Narrative</span>
            <span className="font-body-sm text-body-sm text-on-surface-variant">Free-text semantic seed parsed for dense vector cosine similarity matching.</span>
          </div>
          <div className="font-data-mono-sm text-data-mono-sm text-on-surface-variant">
            TOKENS: <span className="text-primary font-bold">{profile.profile_text?.length || 0} / 512</span>
          </div>
        </div>
        <div className="relative group mt-space-xs">
          <textarea
            className="w-full bg-surface-container-lowest p-space-md font-body-lg text-body-lg text-on-surface focus:outline-none focus:ring-0 leading-relaxed resize-y selection:bg-primary-container selection:text-on-primary-container placeholder:text-outline-variant"
            placeholder="Enter core research agenda, targeted domains, experimental methodologies, and federal funding priorities..."
            rows={4}
            value={profile.profile_text}
            onChange={(e) => setProfile({ ...profile, profile_text: e.target.value })}
          />
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-outline-variant group-focus-within:bg-primary-container transition-colors"></div>
        </div>
        <div className="flex items-center justify-between font-data-mono-sm text-data-mono-sm text-on-surface-variant pt-space-2xs">
          <span className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-[14px] text-secondary">memory</span>
            Vector re-indexing interval: continuous
          </span>
          <span className="text-on-surface-variant">Embedding depth: 1536-dim semantic space</span>
        </div>
      </section>

      {/* Section 3: Weighted Terms & Heuristic Calibration Table */}
      <section className="bg-surface-container-low p-space-xl flex flex-col gap-space-lg">
        <div className="flex items-center justify-between pb-space-xs">
          <div className="flex flex-col">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">Section 03 // Weighted Terms (Vocabulary &amp; Calibration)</span>
            <span className="font-body-sm text-body-sm text-on-surface-variant">Explicit term penalties and coefficients applied during post-vector rank arbitration.</span>
          </div>
          <div className="font-data-mono-sm text-data-mono-sm text-on-surface-variant">
            ACTIVE VOCABULARY: <span className="text-on-surface font-bold">{(profile.profile_terms || []).length} ITEMS</span>
          </div>
        </div>
        {/* Ledger Table */}
        <div className="w-full overflow-x-auto">
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
        <div className="flex flex-col md:flex-row gap-space-md pt-space-xs">
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
            className="inline-flex items-center gap-space-xs font-data-mono-sm text-data-mono-sm text-primary hover:text-primary-fixed transition-colors underline decoration-dashed underline-offset-4 decoration-outline-variant hover:decoration-primary"
            type="button"
            onClick={addTerm}
          >
            <span className="material-symbols-outlined text-[14px]">add_circle</span>
            <span>APPEND CALIBRATED TERM TO MATRIX</span>
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
              Lower tier opportunities will be archived into the background repository and omitted from priority radar telemetry.
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
              Solicitations with closing windows beyond this temporal horizon are tracked silently without generating active telemetry alerts.
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
        <div className="flex items-center gap-space-sm font-data-mono-sm text-data-mono-sm text-on-surface-variant">
          <span className="w-1.5 h-1.5 bg-secondary inline-block"></span>
          <span>Unsaved parameter changes pending engine submission.</span>
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
            <span>{saving ? 'Saving...' : 'Save Profile Calibration'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
