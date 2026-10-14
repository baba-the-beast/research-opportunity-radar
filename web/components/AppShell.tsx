'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ConfigBanner } from '@/components/ConfigBanner';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowserClient';

const AUTH_PATHS = new Set([
  '/login',
  '/register',
  '/verify-email',
  '/forgot-password',
  '/reset-password'
]);

/** Single source for the sidebar and the mobile bottom bar. On mobile, Settings is behind the avatar and Activity is an icon in the header. */
const NAV = [
  { href: '/', label: 'Feed', icon: 'radar', mobile: true },
  { href: '/deadlines', label: 'Deadlines', icon: 'calendar_clock', mobile: true },
  { href: '/applications', label: 'Applications', icon: 'assignment', mobile: true },
  { href: '/digests', label: 'Digests', icon: 'auto_stories', mobile: true },
  { href: '/profile', label: 'Profile', icon: 'person', mobile: true },
  { href: '/activity', label: 'Activity', icon: 'monitoring', mobile: false },
  { href: '/settings', label: 'Settings', icon: 'settings', mobile: false }
] as const;

/** Shown in the sidebar only to research offices, operators and admins. */
const PILOT_ROLES = new Set(['research_office', 'operator', 'admin']);
const PILOT_NAV = { href: '/pilot', label: 'Pilot results', icon: 'query_stats', mobile: false } as const;

/** Opportunity detail pages belong to the feed. */
function isActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/' || pathname.startsWith('/opportunities');
  return pathname === href;
}

function displayName(user: { email?: string; user_metadata?: { full_name?: string } }): string {
  return user.user_metadata?.full_name || user.email?.split('@')[0] || 'Researcher';
}

function initials(name: string): string {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/**
 * Interactive application chrome (header, sidebar, mobile bottom nav, auth state).
 * Rendered by the server root layout in app/layout.tsx.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isAuthPage = AUTH_PATHS.has(pathname);

  const [user, setUser] = useState<{ id: string; email?: string; name: string; role?: string } | null>(null);

  useEffect(() => {
    try {
      const supabase = getSupabaseBrowserClient();
      supabase.auth
        .getUser()
        .then(({ data: { user } }) =>
          setUser(user ? { id: user.id, email: user.email, name: displayName(user), role: (user.app_metadata as any)?.role } : null)
        )
        .catch(() => setUser(null));

      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        const u = session?.user;
        setUser(u ? { id: u.id, email: u.email, name: displayName(u), role: (u.app_metadata as any)?.role } : null);
      });
      return () => subscription.unsubscribe();
    } catch {
      // Supabase not configured: stay signed out
    }
  }, []);

  const handleSignOut = async () => {
    try {
      await getSupabaseBrowserClient().auth.signOut();
      setUser(null);
      router.push('/login');
      router.refresh();
    } catch {
      // Ignore
    }
  };

  if (isAuthPage) return <main className="min-h-screen">{children}</main>;

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-surface/85 backdrop-blur-md border-b border-outline-variant pt-safe">
        <div className="h-14 w-full px-space-md sm:px-space-xl flex items-center justify-between gap-space-md">
          <Link href="/" className="flex items-center gap-space-sm min-w-0">
            <svg className="w-6 h-6 shrink-0 text-primary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="2" opacity="0.35"/>
              <circle cx="16" cy="16" r="7" stroke="currentColor" strokeWidth="2" opacity="0.7"/>
              <circle cx="16" cy="16" r="2.5" fill="currentColor"/>
              <line x1="16" y1="16" x2="26" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span className="text-[15px] font-semibold text-on-surface truncate">
              Opportunity Radar
            </span>
          </Link>

          <div className="flex items-center gap-space-sm sm:gap-space-md shrink-0">
            <ThemeToggle />
            {user ? (
              <>
                {/* Activity is not in the mobile bottom bar, so link it here below lg */}
                <Link
                  href="/activity"
                  title="Activity"
                  aria-label="Activity"
                  aria-current={pathname === '/activity' ? 'page' : undefined}
                  className="lg:hidden w-11 h-11 sm:w-9 sm:h-9 rounded-lg inline-flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
                >
                  <span className="material-symbols-outlined text-[20px]" aria-hidden="true">monitoring</span>
                </Link>
                <Link
                  href="/settings"
                  title={`${user.name} · Settings`}
                  aria-label="Account settings"
                  className="w-11 h-11 sm:w-9 sm:h-9 rounded-full bg-primary-soft flex items-center justify-center text-[12px] font-semibold text-primary hover:ring-2 hover:ring-primary/30 transition-shadow"
                >
                  {initials(user.name)}
                </Link>
                <button
                  onClick={handleSignOut}
                  title="Sign out"
                  aria-label="Sign out"
                  className="hidden sm:inline-flex p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-surface-container-high transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">logout</span>
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="px-4 min-h-11 sm:min-h-9 inline-flex items-center rounded-lg bg-primary text-on-primary text-body-sm font-semibold hover:bg-primary-fixed transition-colors"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Desktop sidebar: an icon rail that expands over the page on hover or keyboard focus.
          Labels stay in the DOM (only faded), so links keep their accessible names when collapsed. */}
      <aside
        aria-label="Main"
        className="group hidden lg:flex fixed left-0 top-14 h-[calc(100vh-3.5rem)] w-16 hover:w-56 focus-within:w-56 overflow-hidden bg-background border-r border-outline-variant hover:surface-card focus-within:surface-card z-40 flex-col px-2 py-space-lg transition-[width,box-shadow] duration-200 ease-out delay-0 hover:delay-100"
      >
        <nav className="flex flex-col gap-0.5">
          {[...NAV, ...(user?.role && PILOT_ROLES.has(user.role) ? [PILOT_NAV] : [])].map(({ href, label, icon }) => {
            const active = isActive(href, pathname);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                title={label}
                className={`flex items-center gap-3 px-3.5 h-10 rounded-lg font-body-md text-body-md whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-primary-soft text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-[20px] shrink-0" aria-hidden="true">
                  {icon}
                </span>
                <span className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 group-hover:delay-100">
                  {label}
                </span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="pl-0 lg:pl-16 pb-20 lg:pb-0">
        <main className="relative pt-14 min-h-screen">
          <ConfigBanner />
          {children}
        </main>
      </div>

      {/* Mobile bottom bar */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 pb-safe bg-surface/95 backdrop-blur-xl border-t border-outline-variant">
        <div className="grid grid-cols-5 items-center h-16">
          {NAV.filter((item) => item.mobile).map(({ href, label, icon }) => {
            const active = isActive(href, pathname);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center justify-center gap-space-2xs h-full transition-colors ${
                  active ? 'text-primary font-semibold' : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">{icon}</span>
                <span className="text-[11px]">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
