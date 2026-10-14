'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowserClient';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    if (password.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }

    setLoading(true);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        setErrorMessage(error.message);
      } else {
        setSuccess(true);
        setTimeout(() => {
          router.push('/login');
        }, 2000);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to reset password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md bg-surface surface-card rounded-2xl p-8 sm:p-10">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-full bg-surface-container-high border border-primary/40 flex items-center justify-center mb-3">
            <span aria-hidden="true" className="material-symbols-outlined text-primary text-[24px]">lock_reset</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface">
            Create New Password
          </h1>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
            Choose a new password for your account.
          </p>
        </div>

        {success ? (
          <div className="text-center">
            <div className="p-4 rounded-lg bg-surface-container-high border border-outline-variant text-body-sm text-secondary font-bold mb-4">
              Password successfully updated! Redirecting to sign in...
            </div>
            <Link
              href="/login"
              className="inline-block w-full py-2.5 px-4 rounded-lg bg-primary text-on-primary font-bold font-body-sm"
            >
              Sign In Now
            </Link>
          </div>
        ) : (
          <form onSubmit={handleReset} className="flex flex-col gap-4">
            {errorMessage && (
              <div role="alert" className="p-3 rounded-lg bg-error-container/40 border border-error/30 text-body-sm text-on-surface">
                {errorMessage}
              </div>
            )}

            <div>
              <label htmlFor="reset-field-1" className="block font-label-caps text-label-caps text-on-surface-variant   mb-1">
                New Password
              </label>
              <input id="reset-field-1"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 8 characters"
                className="w-full rounded-lg border border-outline bg-surface text-body-md text-on-surface px-3 min-h-11 sm:min-h-10 placeholder:text-on-surface-variant/70 hover:border-on-surface-variant focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
              />
            </div>

            <div>
              <label htmlFor="reset-field-2" className="block font-label-caps text-label-caps text-on-surface-variant   mb-1">
                Confirm New Password
              </label>
              <input id="reset-field-2"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                className="w-full rounded-lg border border-outline bg-surface text-body-md text-on-surface px-3 min-h-11 sm:min-h-10 placeholder:text-on-surface-variant/70 hover:border-on-surface-variant focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3 px-4 rounded-lg bg-primary text-on-primary font-bold font-body-md hover:bg-primary-fixed-dim transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? 'Updating Password...' : 'Save New Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
