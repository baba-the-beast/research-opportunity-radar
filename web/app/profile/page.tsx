'use client';

import { useEffect, useRef, useState } from 'react';
import { BANDS } from '@/lib/match';
import { requestRescore } from '@/lib/rescore';
import { useUnsavedChanges } from '@/lib/useUnsavedChanges';
import { Button, CollapsiblePanel, Field, Icon, LoadingRows, Notice, Page, PageHeader, Panel, SegmentedControl, controlClass } from '@/components/ui';

type TermType = 'topic' | 'method' | 'application' | 'venue' | 'funding_theme';

interface ProfileTermItem {
  term: string;
  term_type: TermType;
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

const TERM_TYPES: { value: TermType; label: string }[] = [
  { value: 'topic', label: 'Topic' },
  { value: 'method', label: 'Method' },
  { value: 'application', label: 'Application' },
  { value: 'venue', label: 'Journal or conference' },
  { value: 'funding_theme', label: 'Funding theme' }
];
const termTypeLabel = (t: string) => TERM_TYPES.find((x) => x.value === t)?.label ?? t;

function keywordsFromText(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
}

type Errors = Partial<Record<'full_name' | 'institution' | 'keywords' | 'profile_text', string>>;

export default function ProfilePage() {
  const [profile, setProfile] = useState<any>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [keywordsText, setKeywordsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [newTerm, setNewTerm] = useState('');
  const [newType, setNewType] = useState<TermType>('topic');
  const [minBand, setMinBand] = useState('watch');
  const [alertWindow, setAlertWindow] = useState(30);
  const [orcidInput, setOrcidInput] = useState('');
  const [fetchingOrcid, setFetchingOrcid] = useState(false);
  const [orcidMessage, setOrcidMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const { id: _id, ...editable } = profile;
  const { dirty, markSaved, allowLeave } = useUnsavedChanges({ editable, keywordsText, minBand, alertWindow }, !loading);

  const set = (patch: Record<string, unknown>) => setProfile((prev: any) => ({ ...prev, ...patch }));

  const handleOrcidFetch = async () => {
    if (!orcidInput.trim()) return;
    setFetchingOrcid(true);
    setOrcidMessage(null);
    try {
      const res = await fetch(`/api/profile/orcid?orcid=${encodeURIComponent(orcidInput.trim())}`);
      const data = await res.json();
      if (!res.ok) {
        const detail = typeof data.error === 'string' ? data.error : data.error?.message;
        setOrcidMessage({ ok: false, text: `Import failed: ${detail || 'check the ORCID iD and try again.'}` });
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
      setOrcidMessage({
        ok: true,
        text: `Imported ${data.full_name || 'your record'}: ${data.works_count || 0} works and ${data.candidate_terms?.length || 0} suggested keywords. Review the fields below, then save.`
      });
    } catch (err: any) {
      setOrcidMessage({ ok: false, text: `Import failed: ${err.message}. Check your connection and try again.` });
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
      .catch(() => setSaveMessage({ ok: false, text: 'Your profile did not load. Refresh the page to try again.' }))
      .finally(() => setLoading(false));
  }, []);

  // Institution suggestions, fetched 250 ms after typing stops
  const [institutionOptions, setInstitutionOptions] = useState<string[]>([]);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lookupInstitutions = (text: string) => {
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    if (text.trim().length < 2) return setInstitutionOptions([]);
    lookupTimer.current = setTimeout(() => {
      fetch(`/api/institutions?q=${encodeURIComponent(text.trim())}`)
        .then((res) => (res.ok ? res.json() : []))
        .then((body) => setInstitutionOptions(Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : []))
        .catch(() => setInstitutionOptions([]));
    }, 250);
  };

  const handleSave = async () => {
    const keywords = keywordsFromText(keywordsText);
    const nextErrors: Errors = {};
    if (!profile.full_name?.trim()) nextErrors.full_name = 'Enter your name.';
    if (!profile.institution?.trim()) nextErrors.institution = 'Enter your institution.';
    if (keywords.length === 0) nextErrors.keywords = 'Add at least one research keyword.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setSaveMessage({ ok: false, text: `Not saved. Fix the ${Object.keys(nextErrors).length === 1 ? 'highlighted field' : `${Object.keys(nextErrors).length} highlighted fields`}.` });
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
      setProfile((prev: any) => ({ ...prev, id: body?.profile_id || prev.id, research_keywords: keywords }));
      const rescore = await requestRescore();
      setSaveMessage({
        ok: true,
        text:
          rescore === 'started'
            ? 'Profile saved. Your matches are being recalculated and appear in your feed in a few minutes.'
            : 'Profile saved. Match scores update on the next scan.'
      });
      markSaved();
    } catch (err: any) {
      setSaveMessage({ ok: false, text: `Not saved: ${err.message}. Check your connection and try again.` });
    } finally {
      setSaving(false);
    }
  };

  const addTerm = () => {
    if (!newTerm.trim()) return;
    set({ profile_terms: [...(profile.profile_terms || []), { term: newTerm.trim(), term_type: newType, weight: 0.9, polarity: 'positive' }] });
    setNewTerm('');
  };

  const removeTerm = (index: number) => set({ profile_terms: (profile.profile_terms || []).filter((_: any, i: number) => i !== index) });

  const togglePolarity = (index: number) =>
    set({
      profile_terms: (profile.profile_terms || []).map((t: ProfileTermItem, i: number) =>
        i === index ? { ...t, polarity: t.polarity === 'positive' ? 'negative' : 'positive' } : t
      )
    });

  if (loading) {
    return (
      <Page narrow>
        <Panel>
          <LoadingRows rows={5} label="Loading your profile" />
        </Panel>
      </Page>
    );
  }

  const terms: ProfileTermItem[] = profile.profile_terms || [];
  // Open the eligibility section once any of its fields is filled; new users can skip it
  const eligibilityFilled = [
    profile.designation, profile.employment_type, profile.institution_type, profile.state,
    profile.citizenship_status, profile.date_of_birth, profile.phd_year, profile.superannuation_year
  ].some((v) => v !== null && v !== undefined && String(v).trim() !== '');
  // Errors stay until fixed; a success message gives way to the unsaved-changes notice
  const statusText = saveMessage && (!saveMessage.ok || !dirty)
    ? saveMessage.text
    : dirty
      ? 'You have unsaved changes.'
      : profile.id
        ? 'All changes saved.'
        : 'New profile. Fill in the required fields, then save.';
  const statusTone = saveMessage && !saveMessage.ok ? 'text-error' : saveMessage?.ok && !dirty ? 'text-secondary' : 'text-on-surface-variant';
  const select = (value: string, onChange: (v: string) => void, options: string[], control: object) => (
    <select {...control} className={controlClass} value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">Not set</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );

  return (
    <Page narrow>
      <PageHeader
        title="Your research profile"
        description="Your research interests decide which calls you see and how they rank. Eligibility details let us flag calls you cannot apply for; leave any of them blank and those calls are marked for you to check."
      />

      <Panel title="Import from ORCID" description="Fill in your name, affiliation and suggested keywords from your public ORCID record. You can edit everything before saving.">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <Field label="ORCID iD" className="flex-1">
              {(c) => (
                <input
                  {...c}
                  className={controlClass}
                  type="text"
                  inputMode="numeric"
                  placeholder="0000-0002-1825-0097"
                  value={orcidInput}
                  onChange={(e) => setOrcidInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleOrcidFetch()}
                />
              )}
            </Field>
            <Button variant="secondary" icon="download" onClick={handleOrcidFetch} disabled={fetchingOrcid || !orcidInput.trim()}>
              {fetchingOrcid ? 'Importing…' : 'Import'}
            </Button>
          </div>
          {orcidMessage && <Notice tone={orcidMessage.ok ? 'success' : 'danger'}>{orcidMessage.text}</Notice>}
        </div>
      </Panel>

      <Panel title="About you">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Name" error={errors.full_name} className="sm:col-span-2">
            {(c) => <input {...c} className={controlClass} type="text" autoComplete="name" placeholder="Dr. Priya Sharma" value={profile.full_name || ''} onChange={(e) => set({ full_name: e.target.value })} />}
          </Field>
          <Field
            label="Institution"
            hint="Pick it from the list if it is there, so you match colleagues and your research office."
            error={errors.institution}
          >
            {(c) => (
              <>
                <input
                  {...c}
                  className={controlClass}
                  type="text"
                  autoComplete="organization"
                  list="institution-options"
                  value={profile.institution || ''}
                  onChange={(e) => {
                    set({ institution: e.target.value });
                    lookupInstitutions(e.target.value);
                  }}
                />
                <datalist id="institution-options">
                  {institutionOptions.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label="Department" optional>
            {(c) => <input {...c} className={controlClass} type="text" value={profile.department || ''} onChange={(e) => set({ department: e.target.value })} />}
          </Field>
        </div>
      </Panel>

      <Panel title="Research interests" description="This is what calls are matched against.">
        <div className="flex flex-col gap-5">
          <Field
            label="Research keywords"
            hint='Separate with commas. Be specific: "graph neural networks" finds better calls than "AI".'
            error={errors.keywords}
          >
            {(c) => (
              <input
                {...c}
                className={controlClass}
                type="text"
                placeholder="graph neural networks, fraud detection, edge AI"
                value={keywordsText}
                onChange={(e) => setKeywordsText(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Research summary"
            optional
            hint="A few sentences in your own words. Keywords are enough to get started; a summary ranks calls more precisely."
            error={errors.profile_text}
          >
            {(c) => (
              <textarea
                {...c}
                className={`${controlClass} py-2.5 leading-relaxed`}
                rows={5}
                placeholder="I work on graph neural networks for detecting financial fraud, with a focus on explainability and running models on edge devices."
                value={profile.profile_text || ''}
                onChange={(e) => set({ profile_text: e.target.value })}
              />
            )}
          </Field>
        </div>
      </Panel>

      <CollapsiblePanel
        title="Fine-tune matching"
        summary="Optional. Raise or exclude specific terms, for example a field that shares your keywords."
        defaultOpen={terms.length > 0}
      >
        <div className="flex flex-col gap-4">
          {terms.length > 0 && (
            <ul className="flex flex-col divide-y divide-outline-variant border-y border-outline-variant">
              {terms.map((t, idx) => (
                <li key={`${t.term}-${idx}`} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className={`text-body-md font-semibold ${t.polarity === 'negative' ? 'text-on-surface-variant line-through decoration-error/60' : 'text-on-surface'}`}>
                      {t.term}
                    </span>
                    <span className="text-body-sm text-on-surface-variant">{termTypeLabel(t.term_type)}</span>
                  </div>
                  <SegmentedControl
                    label={`How to use "${t.term}"`}
                    value={t.polarity}
                    onChange={(v) => v !== t.polarity && togglePolarity(idx)}
                    options={[
                      { value: 'positive', label: 'Boost' },
                      { value: 'negative', label: 'Exclude' }
                    ]}
                  />
                  <button
                    type="button"
                    onClick={() => removeTerm(idx)}
                    aria-label={`Remove ${t.term}`}
                    className="inline-flex items-center justify-center w-11 h-11 sm:w-9 sm:h-9 rounded-lg text-on-surface-variant hover:text-error hover:bg-error-container transition-colors"
                  >
                    <Icon name="close" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <Field label="New term" className="flex-1">
              {(c) => (
                <input
                  {...c}
                  className={controlClass}
                  type="text"
                  placeholder="federated learning"
                  value={newTerm}
                  onChange={(e) => setNewTerm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addTerm();
                    }
                  }}
                />
              )}
            </Field>
            <Field label="Type" className="sm:w-52">
              {(c) => (
                <select {...c} className={controlClass} value={newType} onChange={(e) => setNewType(e.target.value as TermType)}>
                  {TERM_TYPES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Button icon="add" onClick={addTerm} disabled={!newTerm.trim()}>
              Add term
            </Button>
          </div>
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel
        title="Eligibility details"
        summary={
          eligibilityFilled
            ? "Checked against each call's rules: nationality, age limit, years to retirement, regular post, region-only calls and years since PhD."
            : 'Optional, and you can skip it for now. When a call has a rule that needs one of these, its page asks you for it.'
        }
        defaultOpen={eligibilityFilled}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Designation">{(c) => select(profile.designation, (v) => set({ designation: v }), DESIGNATIONS, c)}</Field>
          <Field label="Position">
            {(c) => (
              <select {...c} className={controlClass} value={profile.employment_type || ''} onChange={(e) => set({ employment_type: e.target.value })}>
                <option value="">Not set</option>
                <option value="regular">Regular / permanent</option>
                <option value="contractual">Contractual / ad hoc</option>
              </select>
            )}
          </Field>
          <Field label="Institution type">{(c) => select(profile.institution_type, (v) => set({ institution_type: v }), INSTITUTION_TYPES, c)}</Field>
          <Field label="State or UT of your institution">{(c) => select(profile.state, (v) => set({ state: v }), STATES, c)}</Field>
          <Field label="Citizenship">{(c) => select(profile.citizenship_status, (v) => set({ citizenship_status: v }), CITIZENSHIP, c)}</Field>
          <Field label="Date of birth">
            {(c) => <input {...c} className={controlClass} type="date" autoComplete="bday" value={profile.date_of_birth || ''} onChange={(e) => set({ date_of_birth: e.target.value })} />}
          </Field>
          <Field label="Year of PhD">
            {(c) => (
              <input
                {...c}
                className={controlClass}
                type="number"
                inputMode="numeric"
                min={1950}
                max={new Date().getFullYear()}
                placeholder="2015"
                value={profile.phd_year ?? ''}
                onChange={(e) => set({ phd_year: e.target.value ? parseInt(e.target.value, 10) : null })}
              />
            )}
          </Field>
          <Field label="Retirement (superannuation) year">
            {(c) => (
              <input
                {...c}
                className={controlClass}
                type="number"
                inputMode="numeric"
                min={new Date().getFullYear()}
                max={2100}
                placeholder="2045"
                value={profile.superannuation_year ?? ''}
                onChange={(e) => set({ superannuation_year: e.target.value ? parseInt(e.target.value, 10) : null })}
              />
            )}
          </Field>
        </div>
      </CollapsiblePanel>

      <div id="digest">
        <Panel title="What goes in your digest">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h3 className="text-body-sm font-semibold text-on-surface">Minimum match</h3>
              <SegmentedControl
                label="Minimum match for your digest"
                value={minBand}
                onChange={setMinBand}
                options={BANDS.map((b) => ({ value: b.key, label: `${b.label} (${b.cutoff})` }))}
              />
              <p className="text-body-sm text-on-surface-variant">New calls at this match level or better go into your digest. High sends only the closest matches.</p>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-body-sm font-semibold text-on-surface">Highlight deadlines within</h3>
              <SegmentedControl
                label="Highlight deadlines within"
                value={alertWindow}
                onChange={setAlertWindow}
                options={[30, 60, 90, 180].map((d) => ({ value: d, label: `${d} days` }))}
              />
              <p className="text-body-sm text-on-surface-variant">
                Reminders are always sent 3 days before the deadline of a call you saved or are applying to.
              </p>
            </div>
          </div>
        </Panel>
      </div>

      {/* Save bar stays in view on this long form; sits above the mobile bottom nav */}
      <div className="sticky bottom-20 lg:bottom-4 z-30">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl surface-card bg-surface/95 backdrop-blur px-4 sm:px-5 py-3">
          <p role="status" aria-live="polite" className={`text-body-sm ${statusTone}`}>
            {statusText}
          </p>
          <div className="flex items-center gap-2">
            {dirty && profile.id && (
              <Button
                variant="ghost"
                onClick={() => {
                  allowLeave();
                  window.location.reload();
                }}
              >
                Discard changes
              </Button>
            )}
            <Button variant="primary" onClick={handleSave} disabled={saving || (!dirty && Boolean(profile.id))}>
              {saving ? 'Saving…' : 'Save profile'}
            </Button>
          </div>
        </div>
      </div>
    </Page>
  );
}
