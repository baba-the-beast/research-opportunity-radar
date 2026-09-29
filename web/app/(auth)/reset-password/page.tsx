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
      <div className="w-full max-w-md bg-surface-container border border-outline-variant/30 rounded-xl p-8 shadow-2xl">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-full bg-surface-container-high border border-primary/40 flex items-center justify-center mb-3">
            <span className="material-symbols-outlined text-primary text-[24px]">lock_reset</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface">
            Create New Password
          </h1>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
            Choose a robust credential for your observatory node
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
              <div className="p-3 rounded-lg bg-error-container/40 border border-error/30 text-body-sm text-on-surface">
                {errorMessage}
              </div>
            )}

            <div>
              <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider mb-1">
                New Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 8 characters"
                className="w-full px-3.5 py-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant/40 text-on-surface placeholder:text-on-surface-variant/40 focus:border-primary focus:outline-none text-body-md"
              />
            </div>

            <div>
              <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider mb-1">
                Confirm New Password
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                className="w-full px-3.5 py-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant/40 text-on-surface placeholder:text-on-surface-variant/40 focus:border-primary focus:outline-none text-body-md"
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
