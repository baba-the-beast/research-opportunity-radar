'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { safeRedirectPath } from '@/lib/safeRedirect';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowserClient';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Validated: `next` comes from the URL and must never send a freshly signed-in user off-site
  const next = safeRedirectPath(searchParams.get('next'));
  const errorParam = searchParams.get('error');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    errorParam === 'auth_callback_failed' ? 'Sign-in did not complete. Please try again.' : null
  );

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      });

      if (error) {
        setErrorMessage(error.message);
        setLoading(false);
        return;
      }

      if (data.session) {
        router.push(next);
        router.refresh();
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'An unexpected error occurred during sign-in.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md bg-surface surface-card rounded-2xl p-8 sm:p-10">
        {/* Observatory Emblem */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-12 h-12 rounded-full bg-surface-container-high border border-primary/40 flex items-center justify-center mb-3">
            <svg className="w-7 h-7 text-primary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" opacity="0.6"/>
              <circle cx="16" cy="16" r="8" stroke="currentColor" strokeWidth="1.5" opacity="0.8"/>
              <circle cx="16" cy="16" r="2.5" fill="currentColor"/>
              <line x1="16" y1="16" x2="27" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>

            </svg>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">
            Sign in
          </h1>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
            See the funding calls and papers that match your research.
          </p>
        </div>

        {errorMessage && (
          <div role="alert" className="mb-6 p-4 rounded-lg bg-error-container/40 border border-error/30 text-on-surface text-body-sm flex items-start gap-2">
            <span aria-hidden="true" className="material-symbols-outlined text-error text-[18px] shrink-0 mt-0.5">error</span>
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div>
            <label htmlFor="login-field-1" className="block font-label-caps text-label-caps text-on-surface-variant   mb-1.5">
              Email
            </label>
            <input id="login-field-1"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@university.ac.in"
              className="w-full rounded-lg border border-outline bg-surface text-body-md text-on-surface px-3 min-h-11 sm:min-h-10 placeholder:text-on-surface-variant/70 hover:border-on-surface-variant focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="login-field-2" className="font-label-caps text-label-caps text-on-surface-variant  ">
                Password
              </label>
              <Link
                href="/forgot-password"
                className="font-body-sm text-body-sm text-primary hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <input id="login-field-2"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full rounded-lg border border-outline bg-surface text-body-md text-on-surface px-3 min-h-11 sm:min-h-10 placeholder:text-on-surface-variant/70 hover:border-on-surface-variant focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 px-4 rounded-lg bg-primary text-on-primary font-bold font-body-md hover:bg-primary-fixed-dim transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin"></span>
                <span>Signing in…</span>
              </>
            ) : (
              <>
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">lock_open</span>
                <span>Sign in</span>
              </>
            )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-outline-variant/20 text-center">
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            New here?{' '}
            <Link href={`/register${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} className="text-primary font-bold hover:underline">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <LoginForm />
    </Suspense>
  );
}
