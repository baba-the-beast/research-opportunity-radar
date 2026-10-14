'use client';

import { useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowserClient';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const redirectUrl = `${window.location.origin}/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: redirectUrl
      });

      if (error) {
        setErrorMessage(error.message);
      } else {
        setSubmitted(true);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to send password recovery instructions.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md bg-surface surface-card rounded-2xl p-8 sm:p-10">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-full bg-surface-container-high border border-primary/40 flex items-center justify-center mb-3">
            <span aria-hidden="true" className="material-symbols-outlined text-primary text-[24px]">key</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface">
            Reset Password
          </h1>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
            Provide your registered academic email to receive recovery instructions
          </p>
        </div>

        {submitted ? (
          <div className="text-center">
            <div className="p-4 rounded-lg bg-surface-container-high border border-outline-variant/40 text-on-surface text-body-sm mb-6">
              We sent you a link to reset your password. Check your email inbox.
            </div>
            <Link
              href="/login"
              className="inline-block w-full py-2.5 px-4 rounded-lg bg-primary text-on-primary font-bold font-body-sm hover:bg-primary-fixed-dim transition-colors"
            >
              Return to Sign In
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {errorMessage && (
              <div role="alert" className="p-3 rounded-lg bg-error-container/40 border border-error/30 text-body-sm text-on-surface">
                {errorMessage}
              </div>
            )}

            <div>
              <label htmlFor="forgot-field-1" className="block font-label-caps text-label-caps text-on-surface-variant   mb-1">
                Email Address
              </label>
              <input id="forgot-field-1"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@university.ac.in"
                className="w-full rounded-lg border border-outline bg-surface text-body-md text-on-surface px-3 min-h-11 sm:min-h-10 placeholder:text-on-surface-variant/70 hover:border-on-surface-variant focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3 px-4 rounded-lg bg-primary text-on-primary font-bold font-body-md hover:bg-primary-fixed-dim transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>

            <div className="text-center mt-4">
              <Link href="/login" className="font-body-sm text-body-sm text-on-surface-variant hover:text-on-surface">
                Back to Sign In
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
