'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/components/ThemeProvider';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowserClient';

interface SettingsData {
  theme: 'light' | 'dark' | 'system';
  min_score: number;
  email_alerts: boolean;
  telegram_alerts: boolean;
  telegram_chat_id: string | null;
  digest_frequency: 'daily' | 'weekly' | 'never';
  auto_summarize: boolean;
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
    auto_summarize: true
  });

  const [user, setUser] = useState<{ id: string; email?: string; name?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    // Load current user and preferences
    try {
      const supabase = getSupabaseBrowserClient();
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          setUser({
            id: user.id,
            email: user.email,
            name: user.user_metadata?.full_name || 'Investigator'
          });
        }
      });
    } catch {
      // Ignore
    }

    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => {
        if (data?.data) {
          setSettings(data.data);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveSuccess(false);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });

      const data = await res.json();
      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        setErrorMessage(data?.error?.message || 'Failed to save settings.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error saving settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut();
      router.push('/login');
      router.refresh();
    } catch {
      // Ignore
    }
  };

  if (loading) {
    return (
      <div className="p-space-xl max-w-4xl mx-auto flex items-center justify-center min-h-[60vh]">
        <div className="flex items-center gap-3 text-on-surface-variant font-data-mono-sm">
          <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>
          <span>Loading platform settings...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-space-xl max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-outline-variant/30">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">
            Platform Settings
          </h1>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
            Configure observatory interface, relevance thresholds, alert dispatches, and security
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/profile"
            className="px-3.5 py-2 rounded-lg border border-outline-variant text-body-sm text-on-surface hover:bg-surface-container-high transition-colors flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">person_search</span>
            <span>Profile Calibration</span>
          </Link>
          <button
            onClick={handleSignOut}
            className="px-3.5 py-2 rounded-lg bg-error-container/30 border border-error/40 text-on-surface hover:bg-error-container/60 text-body-sm font-bold transition-colors flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px] text-error">logout</span>
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {saveSuccess && (
        <div className="p-4 rounded-xl bg-secondary-container/40 border border-secondary/40 text-on-surface text-body-sm flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary text-[20px]">check_circle</span>
          <span>Observatory configuration saved successfully!</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-4 rounded-xl bg-error-container/40 border border-error/30 text-on-surface text-body-sm flex items-center gap-2">
          <span className="material-symbols-outlined text-error text-[20px]">error</span>
          <span>{errorMessage}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-8">
        {/* Section 1: Visual Theme Calibration */}
        <div className="bg-surface-container border border-outline-variant/30 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-outline-variant/20">
            <span className="material-symbols-outlined text-primary text-[22px]">palette</span>
            <div>
              <h2 className="font-headline-sm text-body-lg font-bold text-on-surface">
                Interface Appearance
              </h2>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Select your preferred visual theme for reading academic calls
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <button
              type="button"
              onClick={() => {
                setTheme('light');
                setSettings({ ...settings, theme: 'light' });
              }}
              className={`p-4 rounded-xl border text-left transition-all ${
                theme === 'light'
                  ? 'border-primary bg-primary/10 shadow-sm'
                  : 'border-outline-variant/40 bg-surface-container-lowest hover:border-outline-variant'
              }`}
            >
              <div className="flex items-center gap-2 font-bold text-on-surface mb-1">
                <span className="material-symbols-outlined text-[20px] text-primary">light_mode</span>
                <span>Light Mode</span>
              </div>
              <p className="text-[12px] text-on-surface-variant">
                Warm academic parchment with crisp ink contrast.
              </p>
            </button>

            <button
              type="button"
              onClick={() => {
                setTheme('dark');
                setSettings({ ...settings, theme: 'dark' });
              }}
              className={`p-4 rounded-xl border text-left transition-all ${
                theme === 'dark'
                  ? 'border-primary bg-primary/10 shadow-sm'
                  : 'border-outline-variant/40 bg-surface-container-lowest hover:border-outline-variant'
              }`}
            >
              <div className="flex items-center gap-2 font-bold text-on-surface mb-1">
                <span className="material-symbols-outlined text-[20px] text-primary">dark_mode</span>
                <span>Dark Mode</span>
              </div>
              <p className="text-[12px] text-on-surface-variant">
                Deep observatory midnight with brass accents.
              </p>
            </button>

            <button
              type="button"
              onClick={() => {
                setTheme('system');
                setSettings({ ...settings, theme: 'system' });
              }}
              className={`p-4 rounded-xl border text-left transition-all ${
                theme === 'system'
                  ? 'border-primary bg-primary/10 shadow-sm'
                  : 'border-outline-variant/40 bg-surface-container-lowest hover:border-outline-variant'
              }`}
            >
              <div className="flex items-center gap-2 font-bold text-on-surface mb-1">
                <span className="material-symbols-outlined text-[20px] text-primary">settings_brightness</span>
                <span>System Automatic</span>
              </div>
              <p className="text-[12px] text-on-surface-variant">
                Dynamically matches your operating system preference.
              </p>
            </button>
          </div>
        </div>

        {/* Section 2: Relevance Calibration Threshold */}
        <div className="bg-surface-container border border-outline-variant/30 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-outline-variant/20">
            <span className="material-symbols-outlined text-primary text-[22px]">tune</span>
            <div>
              <h2 className="font-headline-sm text-body-lg font-bold text-on-surface">
                Minimum Relevance Score
              </h2>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Filter opportunities below this composite match score (0 - 100)
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between font-data-mono-sm text-data-mono-sm">
              <span className="text-on-surface-variant">THRESHOLD FILTER</span>
              <span className="text-primary font-bold text-headline-sm">{settings.min_score} / 100</span>
            </div>
            <input
              type="range"
              min="0"
              max="95"
              step="5"
              value={settings.min_score}
              onChange={(e) => setSettings({ ...settings, min_score: parseInt(e.target.value, 10) })}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[11px] text-on-surface-variant font-data-mono-sm">
              <span>0 (All Opportunities)</span>
              <span>50 (Watch Band)</span>
              <span>75 (Strong Matches Only)</span>
            </div>
          </div>
        </div>

        {/* Section 3: Notification & Alert Channels */}
        <div className="bg-surface-container border border-outline-variant/30 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-outline-variant/20">
            <span className="material-symbols-outlined text-primary text-[22px]">notifications_active</span>
            <div>
              <h2 className="font-headline-sm text-body-lg font-bold text-on-surface">
                Alert Channels & Digest Schedule
              </h2>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Configure when and where the observatory dispatches deadline updates
              </p>
            </div>
          </div>

          <div className="space-y-4 pt-2">
            <label className="flex items-center justify-between p-3.5 rounded-lg bg-surface-container-lowest border border-outline-variant/30 cursor-pointer">
              <div>
                <span className="font-bold text-on-surface text-body-md block">Email Dispatch Alerts</span>
                <span className="font-body-sm text-body-sm text-on-surface-variant">
                  Receive critical deadline warnings and new high-relevance calls via email.
                </span>
              </div>
              <input
                type="checkbox"
                checked={settings.email_alerts}
                onChange={(e) => setSettings({ ...settings, email_alerts: e.target.checked })}
                className="w-5 h-5 accent-primary rounded"
              />
            </label>

            <label className="flex items-center justify-between p-3.5 rounded-lg bg-surface-container-lowest border border-outline-variant/30 cursor-pointer">
              <div>
                <span className="font-bold text-on-surface text-body-md block">Telegram Bot Alerts</span>
                <span className="font-body-sm text-body-sm text-on-surface-variant">
                  Receive immediate push alerts on verified opportunity changes.
                </span>
              </div>
              <input
                type="checkbox"
                checked={settings.telegram_alerts}
                onChange={(e) => setSettings({ ...settings, telegram_alerts: e.target.checked })}
                className="w-5 h-5 accent-primary rounded"
              />
            </label>

            {settings.telegram_alerts && (
              <div className="p-3.5 rounded-lg bg-surface-container-high border border-outline-variant/40 space-y-2">
                <label className="font-label-caps text-label-caps text-on-surface-variant uppercase">
                  Telegram Chat ID
                </label>
                <input
                  type="text"
                  value={settings.telegram_chat_id || ''}
                  onChange={(e) => setSettings({ ...settings, telegram_chat_id: e.target.value.trim() || null })}
                  placeholder="@your_telegram_id or numeric ID"
                  className="w-full px-3.5 py-2 rounded-lg bg-surface-container-lowest border border-outline-variant/40 text-on-surface text-body-sm"
                />
              </div>
            )}

            <div className="p-3.5 rounded-lg bg-surface-container-lowest border border-outline-variant/30 space-y-2">
              <label className="font-label-caps text-label-caps text-on-surface-variant uppercase">
                Digest Frequency
              </label>
              <select
                value={settings.digest_frequency}
                onChange={(e) => setSettings({ ...settings, digest_frequency: e.target.value as any })}
                className="w-full px-3.5 py-2.5 rounded-lg bg-surface-container border border-outline-variant/40 text-on-surface text-body-sm focus:outline-none"
              >
                <option value="daily">Daily Horizon Digest</option>
                <option value="weekly">Weekly Observatory Digest (Recommended)</option>
                <option value="never">Never (Mute scheduled digests)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Section 4: Account & Node Information */}
        <div className="bg-surface-container border border-outline-variant/30 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-outline-variant/20">
            <span className="material-symbols-outlined text-primary text-[22px]">badge</span>
            <div>
              <h2 className="font-headline-sm text-body-lg font-bold text-on-surface">
                Investigator Identity & Node
              </h2>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Active account credentials and node binding
              </p>
            </div>
          </div>

          <div className="space-y-2 text-body-sm font-data-mono-sm">
            <div className="flex justify-between py-2 border-b border-outline-variant/20">
              <span className="text-on-surface-variant">INVESTIGATOR:</span>
              <span className="text-on-surface font-bold">{user?.name || 'Academic Investigator'}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-outline-variant/20">
              <span className="text-on-surface-variant">EMAIL:</span>
              <span className="text-on-surface">{user?.email || 'unconfigured'}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-on-surface-variant">NODE ID:</span>
              <span className="text-on-surface">{user?.id ? `${user.id.slice(0, 16)}...` : 'local-node'}</span>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end pt-4">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-3 rounded-lg bg-primary text-on-primary font-bold font-body-md hover:bg-primary-fixed-dim transition-all shadow-md flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? (
              <>
                <span className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin"></span>
                <span>Saving Preferences...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[18px]">save</span>
                <span>Save All Settings</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
