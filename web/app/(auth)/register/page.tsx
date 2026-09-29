'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { safeRedirectPath } from '@/lib/safeRedirect';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowserClient';

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Validated: `next` comes from the URL and must never send a freshly signed-in user off-site
  const next = safeRedirectPath(searchParams.get('next'));

  const [fullName, setFullName] = useState('');
  const [institution, setInstitution] = useState('');
  const [department, setDepartment] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [keywords, setKeywords] = useState('Artificial Intelligence, Edge Computing, Embedded Systems');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleRegister = async (e: React.FormEvent) => {
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
      const parsedKeywords = keywords
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k.length > 0);

      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            institution: institution.trim(),
            department: department.trim(),
            research_keywords: parsedKeywords
          }
        }
      });

      if (error) {
        setErrorMessage(error.message);
        setLoading(false);
        return;
      }

      if (data.session) {
        // Automatically provision profile record via profile API
        try {
          await fetch('/api/profile', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${data.session.access_token}`
            },
            body: JSON.stringify({
              full_name: fullName.trim(),
              institution: institution.trim(),
              department: department.trim(),
              research_keywords: parsedKeywords,
              profile_text: `${fullName.trim()} conducts research at ${institution.trim()} in ${parsedKeywords.join(', ')}.`,
              profile_terms: parsedKeywords.map((k) => ({
                term: k,
                term_type: 'topic',
                weight: 1.0,
                polarity: 'positive'
              }))
            })
          });
        } catch {
          // Non-blocking: profile will initialize on first load
        }

        router.push(next);
        router.refresh();
      } else {
        // Supabase requires email verification
        router.push(`/verify-email?email=${encodeURIComponent(email)}`);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Registration failed. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg bg-surface-container border border-outline-variant/30 rounded-xl p-8 shadow-2xl backdrop-blur-sm">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-12 h-12 rounded-full bg-surface-container-high border border-primary/40 flex items-center justify-center mb-3">
            <span className="material-symbols-outlined text-primary text-[24px]">person_add</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">
            Register Investigator Profile
          </h1>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
            Establish your observatory node for personalized funding & venue radar
          </p>
        </div>

        {errorMessage && (
          <div className="mb-6 p-4 rounded-lg bg-error-container/40 border border-error/30 text-on-surface text-body-sm flex items-start gap-2">
            <span className="material-symbols-outlined text-error text-[18px] shrink-0 mt-0.5">error</span>
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleRegister} className="flex flex-col gap-4">
          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider mb-1">
              Full Name & Title
            </label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Dr. Eleanor Vance"
              className="w-full px-3.5 py-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant/40 text-on-surface placeholder:text-on-surface-variant/40 focus:border-primary focus:outline-none text-body-md"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider mb-1">
                Institution
              </label>
              <input
                type="text"
                required
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                placeholder="COEP Technological Univ"
                className="w-full px-3.5 py-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant/40 text-on-surface placeholder:text-on-surface-variant/40 focus:border-primary focus:outline-none text-body-md"
              />
            </div>
            <div>
              <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider mb-1">
                Department
              </label>
              <input
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="Computer Science"
                className="w-full px-3.5 py-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant/40 text-on-surface placeholder:text-on-surface-variant/40 focus:border-primary focus:outline-none text-body-md"
              />
            </div>
          </div>

          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider mb-1">
              Academic Email Address
            </label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vance@university.edu"
              className="w-full px-3.5 py-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant/40 text-on-surface placeholder:text-on-surface-variant/40 focus:border-primary focus:outline-none text-body-md"
            />
          </div>

          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider mb-1">
              Core Research Keywords (comma separated)
            </label>
            <input
              type="text"
              required
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="e.g. Edge AI, Sensor Fusion, Robotics"
              className="w-full px-3.5 py-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant/40 text-on-surface placeholder:text-on-surface-variant/40 focus:border-primary focus:outline-none text-body-md"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider mb-1">
                Password
              </label>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 8 characters"
                className="w-full px-3.5 py-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant/40 text-on-surface placeholder:text-on-surface-variant/40 focus:border-primary focus:outline-none text-body-md"
              />
            </div>
            <div>
              <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider mb-1">
                Confirm Password
              </label>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                className="w-full px-3.5 py-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant/40 text-on-surface placeholder:text-on-surface-variant/40 focus:border-primary focus:outline-none text-body-md"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-3 py-3 px-4 rounded-lg bg-primary text-on-primary font-bold font-body-md hover:bg-primary-fixed-dim transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin"></span>
                <span>Initializing Node...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[18px]">verified_user</span>
                <span>Register & Calibrate Radar</span>
              </>
            )}
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-outline-variant/20 text-center">
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Already registered?{' '}
            <Link href={`/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} className="text-primary font-bold hover:underline">
              Sign In
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <RegisterForm />
    </Suspense>
  );
}
