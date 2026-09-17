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
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md bg-surface-container border border-outline-variant/30 rounded-xl p-8 shadow-2xl">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-full bg-surface-container-high border border-primary/40 flex items-center justify-center mb-3">
            <span className="material-symbols-outlined text-primary text-[24px]">key</span>
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
              Recovery instructions dispatched! Check your email inbox to proceed with resetting your password.
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
              <div className="p-3 rounded-lg bg-error-container/40 border border-error/30 text-body-sm text-on-surface">
                {errorMessage}
              </div>
            )}

            <div>
              <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider mb-1">
                Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="faculty@university.edu"
                className="w-full px-3.5 py-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant/40 text-on-surface placeholder:text-on-surface-variant/40 focus:border-primary focus:outline-none text-body-md"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3 px-4 rounded-lg bg-primary text-on-primary font-bold font-body-md hover:bg-primary-fixed-dim transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? 'Dispatching...' : 'Send Recovery Dispatch'}
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
