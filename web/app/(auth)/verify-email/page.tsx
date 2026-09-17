'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowserClient';

function VerifyEmailForm() {
  const searchParams = useSearchParams();
  const email = searchParams.get('email') || '';
  const [resending, setResending] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const handleResend = async () => {
    if (!email) return;
    setResending(true);
    setStatusMsg(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email
      });
      if (error) {
        setStatusMsg(`Failed to resend: ${error.message}`);
      } else {
        setStatusMsg('Verification email resent successfully! Check your inbox.');
      }
    } catch (err: any) {
      setStatusMsg(err.message || 'Error resending email.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md bg-surface-container border border-outline-variant/30 rounded-xl p-8 shadow-2xl text-center">
        <div className="w-14 h-14 rounded-full bg-secondary-container/40 border border-secondary/40 flex items-center justify-center mx-auto mb-4">
          <span className="material-symbols-outlined text-secondary text-[30px]">mark_email_unread</span>
        </div>

        <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">
          Verify Your Academic Email
        </h1>

        <p className="font-body-md text-body-md text-on-surface-variant mb-6">
          A confirmation dispatch has been sent to{' '}
          <strong className="text-on-surface">{email || 'your email'}</strong>. Please click the verification link inside to activate your observatory node.
        </p>

        {statusMsg && (
          <div className="mb-4 p-3 rounded-lg bg-surface-container-high border border-outline-variant text-body-sm text-on-surface">
            {statusMsg}
          </div>
        )}

        <div className="flex flex-col gap-3">
          {email && (
            <button
              onClick={handleResend}
              disabled={resending}
              className="w-full py-2.5 px-4 rounded-lg bg-surface-container-high border border-outline-variant text-on-surface hover:bg-surface-container-highest transition-colors font-body-sm flex items-center justify-center gap-2"
            >
              {resending ? 'Sending...' : 'Resend Verification Dispatch'}
            </button>
          )}

          <Link
            href="/login"
            className="w-full py-2.5 px-4 rounded-lg bg-primary text-on-primary font-bold font-body-sm hover:bg-primary-fixed-dim transition-colors text-center"
          >
            Return to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <VerifyEmailForm />
    </Suspense>
  );
}
