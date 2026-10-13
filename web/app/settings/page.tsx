'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/components/ThemeProvider';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowserClient';
import { TelegramConnect } from '@/components/TelegramConnect';
import { DEFAULT_SOURCES, SOURCE_OPTIONS } from '@/lib/sources';
import { useUnsavedChanges } from '@/lib/useUnsavedChanges';
import { DEFAULT_REMINDER_DAYS, REMINDER_OPTIONS } from '@/lib/reminders';
import { Badge, Button, Field, LoadingRows, Notice, Page, PageHeader, Panel, SegmentedControl, Switch, controlClass } from '@/components/ui';

interface SettingsData {
  theme: 'light' | 'dark' | 'system';
  min_score: number;
  email_alerts: boolean;
  telegram_alerts: boolean;
  telegram_chat_id: string | null;
  digest_frequency: 'daily' | 'weekly' | 'never';
  preferred_sources: string[];
  reminder_days: number[];
}

export default function SettingsPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  const [settings, setSettings] = useState<SettingsData>({
    theme: 'system',
    min_score: 50,
    email_alerts: true,
    telegram_alerts: false,
    telegram_chat_id: null,
    digest_frequency: 'weekly',
    preferred_sources: DEFAULT_SOURCES,
    reminder_days: DEFAULT_REMINDER_DAYS
  });

  const [user, setUser] = useState<{ id: string; email?: string; name?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Last saved reminders: only sent when changed, so saving still works before the reminders migration
  const savedReminders = useRef<string>(JSON.stringify(DEFAULT_REMINDER_DAYS));

  useEffect(() => {
    try {
      const supabase = getSupabaseBrowserClient();
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          setUser({
            id: user.id,
            email: user.email,
            name: user.user_metadata?.full_name || 'Researcher'
          });
        }
      });
    } catch {
      // Supabase not configured: no account section details
    }

    fetch('/api/settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          const reminders = Array.isArray(data.reminder_days) ? [...data.reminder_days].sort((a: number, b: number) => b - a) : DEFAULT_REMINDER_DAYS;
          savedReminders.current = JSON.stringify(reminders);
          setSettings((prev) => ({ ...prev, ...data, reminder_days: reminders, preferred_sources: data.preferred_sources?.length ? data.preferred_sources : DEFAULT_SOURCES }));
        }
      })
      .catch(() => setErrorMessage('Your settings did not load. Refresh the page before making changes.'))
      .finally(() => setLoading(false));
  }, []);

  const { theme: _theme, ...editable } = settings;
  const { dirty, markSaved } = useUnsavedChanges({ ...editable, preferred_sources: [...editable.preferred_sources].sort() }, !loading);

  const update = (patch: Partial<SettingsData>) => {
    setSaveSuccess(false);
    setSettings((prev) => ({ ...prev, ...patch }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings.preferred_sources.length) {
      setErrorMessage('Not saved. Choose at least one source to search.');
      return;
    }
    setSaving(true);
    setSaveSuccess(false);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // telegram_chat_id is linked by the bot (Connect Telegram), never saved from this form
        body: JSON.stringify({
          theme: settings.theme,
          min_score: settings.min_score,
          email_alerts: settings.email_alerts,
          telegram_alerts: settings.telegram_alerts,
          digest_frequency: settings.digest_frequency === 'daily' ? 'weekly' : settings.digest_frequency,
          preferred_sources: settings.preferred_sources,
          ...(JSON.stringify(settings.reminder_days) !== savedReminders.current ? { reminder_days: settings.reminder_days } : {})
        })
      });

      const data = await res.json().catch(() => null);
      if (res.ok) {
        setSaveSuccess(true);
        savedReminders.current = JSON.stringify(settings.reminder_days);
        markSaved();
      } else {
        setErrorMessage(`Not saved: ${data?.error?.message || `HTTP ${res.status}`}`);
      }
    } catch (err: any) {
      setErrorMessage(`Not saved: ${err.message}. Check your connection and try again.`);
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await getSupabaseBrowserClient().auth.signOut();
      router.push('/login');
      router.refresh();
    } catch {
      setErrorMessage('Sign-out failed. Refresh the page and try again.');
    }
  };

  if (loading) {
    return (
      <Page narrow>
        <Panel>
          <LoadingRows rows={4} label="Loading settings" />
        </Panel>
      </Page>
    );
  }

  const indiaSources = SOURCE_OPTIONS.filter((s) => s.region !== 'us');
  const usSources = SOURCE_OPTIONS.filter((s) => s.region === 'us');
  const sourceList = (list: typeof SOURCE_OPTIONS) => (
    <ul className="flex flex-col divide-y divide-outline-variant border-y border-outline-variant">
      {list.map((source) => {
        const checked = settings.preferred_sources.includes(source.id);
        return (
          <li key={source.id}>
            <label className="flex items-start gap-3 py-3 cursor-pointer">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) =>
                  update({
                    preferred_sources: e.target.checked
                      ? [...settings.preferred_sources, source.id]
                      : settings.preferred_sources.filter((id) => id !== source.id)
                  })
                }
                className="w-5 h-5 mt-0.5 accent-primary shrink-0"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-body-md font-semibold text-on-surface">{source.label}</span>
                <span className="text-body-sm text-on-surface-variant">{source.description}</span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );

  return (
    <Page narrow>
      <PageHeader title="Settings" description="How and when you hear about new calls, where we search, and your account." />

      {errorMessage && <Notice tone="danger">{errorMessage}</Notice>}

      <form onSubmit={handleSave} className="flex flex-col gap-8">
        <Panel title="Notifications" description="Digests are sent after each scan, on Monday and Thursday mornings (IST).">
          <div className="flex flex-col divide-y divide-outline-variant -my-3">
            <Switch
              checked={settings.email_alerts}
              onChange={(v) => update({ email_alerts: v })}
              label="Email"
              description="New matching calls and reminders 3 days before deadlines."
            />
            <div className="flex flex-col gap-3 pb-3">
              <Switch
                checked={settings.telegram_alerts}
                onChange={(v) => update({ telegram_alerts: v })}
                label={
                  <span className="inline-flex items-center gap-2">
                    Telegram {settings.telegram_chat_id && <Badge tone="success">Connected</Badge>}
                  </span>
                }
                description="The same digests and reminders, in a Telegram chat."
              />
              {(settings.telegram_alerts || settings.telegram_chat_id) && (
                <TelegramConnect
                  connected={Boolean(settings.telegram_chat_id)}
                  onConnectionChange={(change) => setSettings((prev) => ({ ...prev, ...change }))}
                />
              )}
            </div>
            <div className="py-4">
              <Field label="Digest">
                {(c) => (
                  <select
                    {...c}
                    value={settings.digest_frequency === 'daily' ? 'weekly' : settings.digest_frequency}
                    onChange={(e) => update({ digest_frequency: e.target.value as SettingsData['digest_frequency'] })}
                    className={controlClass}
                  >
                    <option value="weekly">After every scan (twice a week)</option>
                    <option value="never">Off (deadline reminders only)</option>
                  </select>
                )}
              </Field>
            </div>
            <fieldset className="py-4 flex flex-col gap-2">
              <legend className="text-body-md font-semibold text-on-surface">Deadline reminders</legend>
              <p className="text-body-sm text-on-surface-variant">
                For calls you saved, are applying to, or that match you strongly, and for your own deadlines. Reminders go out with
                the next scan (Monday or Thursday morning) after a deadline comes this close.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {REMINDER_OPTIONS.map((days) => {
                  const on = settings.reminder_days.includes(days);
                  return (
                    <label
                      key={days}
                      className={`inline-flex items-center gap-2 min-h-11 sm:min-h-9 px-3 rounded-lg border cursor-pointer text-body-sm transition-colors ${
                        on ? 'border-primary bg-primary-soft text-primary font-semibold' : 'border-outline text-on-surface hover:bg-surface-container'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) =>
                          update({
                            reminder_days: (e.target.checked
                              ? [...settings.reminder_days, days]
                              : settings.reminder_days.filter((d) => d !== days)
                            ).sort((a, b) => b - a)
                          })
                        }
                        className="w-4 h-4 accent-primary"
                      />
                      {days === 1 ? '1 day before' : `${days} days before`}
                    </label>
                  );
                })}
              </div>
              {settings.reminder_days.length === 0 && (
                <p className="text-body-sm text-tertiary">Deadline reminders are off. You will not be warned before any deadline.</p>
              )}
            </fieldset>
          </div>
        </Panel>

        <Panel
          title="Score threshold"
          description={
            <>
              Calls below this score are left out of your digest. It works together with the{' '}
              <Link href="/profile#digest" className="text-primary underline underline-offset-4">
                minimum match level
              </Link>{' '}
              in your profile.
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <label htmlFor="min-score" className="text-body-sm font-semibold text-on-surface">
                Minimum score
              </label>
              <span className="text-headline-sm font-semibold text-primary tabular-nums">{settings.min_score}</span>
            </div>
            <input
              id="min-score"
              type="range"
              min="0"
              max="95"
              step="5"
              value={settings.min_score}
              onChange={(e) => update({ min_score: parseInt(e.target.value, 10) })}
              aria-valuetext={`${settings.min_score} out of 100`}
              className="w-full accent-primary h-11 sm:h-6"
            />
            <div className="flex justify-between text-body-sm text-on-surface-variant">
              <span>0, every call</span>
              <span>50, watch and above</span>
              <span>80, high only</span>
            </div>
          </div>
        </Panel>

        <Panel title="Sources" description="Where we search. Indian agencies and calls for papers are on by default.">
          <div className="flex flex-col gap-5">
            {sourceList(indiaSources)}
            {usSources.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="text-body-sm font-semibold text-on-surface">United States</h3>
                <p className="text-body-sm text-on-surface-variant">Mostly open to US institutions only.</p>
                {sourceList(usSources)}
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Appearance" description="Applies right away on this device.">
          <SegmentedControl
            label="Theme"
            value={theme}
            onChange={(v) => {
              setTheme(v);
              update({ theme: v });
            }}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'Match device' }
            ]}
          />
        </Panel>

        <div className="sticky bottom-20 lg:bottom-4 z-30">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl surface-card bg-surface/95 backdrop-blur px-4 sm:px-5 py-3">
            <p role="status" aria-live="polite" className={`text-body-sm ${saveSuccess && !dirty ? 'text-secondary' : 'text-on-surface-variant'}`}>
              {dirty ? 'You have unsaved changes.' : saveSuccess ? 'Settings saved.' : 'All changes saved.'}
            </p>
            <Button type="submit" variant="primary" disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        </div>
      </form>

      <Panel title="Account">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <dl className="flex flex-col gap-0.5 min-w-0">
            <dt className="sr-only">Name</dt>
            <dd className="text-body-md font-semibold text-on-surface">{user?.name || 'Researcher'}</dd>
            <dt className="sr-only">Email</dt>
            <dd className="text-body-sm text-on-surface-variant truncate">{user?.email || 'Not signed in'}</dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Link href="/profile" className="inline-flex items-center min-h-11 sm:min-h-9 px-4 rounded-lg border border-outline-variant text-body-sm font-semibold text-on-surface hover:bg-surface-container">
              Edit research profile
            </Link>
            {user && (
              <Button variant="danger" icon="logout" onClick={handleSignOut}>
                Sign out
              </Button>
            )}
          </div>
        </div>
      </Panel>
    </Page>
  );
}
