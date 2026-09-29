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

/**
 * Interactive application chrome (header, sidebar, mobile drawer and bottom nav, auth state).
 * Rendered by the server root layout in app/layout.tsx.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isAuthPage = AUTH_PATHS.has(pathname);

  const [user, setUser] = useState<{ id: string; email?: string; name?: string } | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  useEffect(() => {
    setMobileDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    try {
      const supabase = getSupabaseBrowserClient();
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          const name = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Investigator';
          setUser({ id: user.id, email: user.email, name });
        } else {
          setUser(null);
        }
        setLoadingUser(false);
      }).catch(() => {
        setUser(null);
        setLoadingUser(false);
      });

      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user) {
          const name = session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Investigator';
          setUser({ id: session.user.id, email: session.user.email, name });
        } else {
          setUser(null);
        }
      });

      return () => subscription.unsubscribe();
    } catch {
      setLoadingUser(false);
    }
  }, []);

  const handleSignOut = async () => {
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut();
      setUser(null);
      router.push('/login');
      router.refresh();
    } catch {
      // Ignore
    }
  };

  const getInitials = (name?: string, email?: string) => {
    if (name) {
      const parts = name.split(' ').filter(Boolean);
      if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
      return name.slice(0, 2).toUpperCase();
    }
    if (email) return email.slice(0, 2).toUpperCase();
    return 'IN';
  };

  return (
    <>
    {isAuthPage ? (
      <main className="min-h-screen">{children}</main>
    ) : (
      <>
        {/* Top Header */}
        <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-surface-container-lowest/90 backdrop-blur-md border-b border-surface-container pt-safe">
          <div className="h-14 w-full px-space-md sm:px-space-xl flex items-center justify-between">
            <div className="flex items-center gap-space-sm sm:gap-space-lg">
              {/* Mobile Drawer Toggle */}
              <button
                onClick={() => setMobileDrawerOpen(!mobileDrawerOpen)}
                className="lg:hidden p-1.5 -ml-1 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors flex items-center justify-center"
                title="Toggle Navigation Menu"
                aria-label="Toggle navigation menu"
              >
                <span className="material-symbols-outlined text-[22px]">
                  {mobileDrawerOpen ? 'close' : 'menu'}
                </span>
              </button>

              <Link href="/" className="flex items-center gap-space-sm sm:gap-space-md min-w-0">
                <svg className="w-6 h-6 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
                  <circle cx="16" cy="16" r="14" stroke="#C08A3E" strokeWidth="1.5" strokeDasharray="2 2" opacity="0.6"/>
                  <circle cx="16" cy="16" r="8" stroke="#C08A3E" strokeWidth="1.5" opacity="0.8"/>
                  <circle cx="16" cy="16" r="2.5" fill="#C08A3E"/>
                  <line x1="16" y1="16" x2="27" y2="9" stroke="#C08A3E" strokeWidth="1.5" strokeLinecap="round"/>
                  <circle cx="23" cy="11" r="1.5" fill="#5B8C7B"/>
                </svg>
                <span className="font-headline-sm text-headline-sm text-on-surface tracking-tight truncate max-w-[170px] sm:max-w-none">
                  Research Opportunity Radar
                </span>
              </Link>
              <div className="h-4 w-px bg-outline-variant hidden sm:block"></div>
              <div className="hidden md:flex items-center gap-space-xs font-data-mono-sm text-data-mono-sm text-on-surface-variant">
                <span className="w-1.5 h-1.5 rounded-full bg-primary-container inline-block animate-pulse"></span>
                <span>autonomous multi-agent watch</span>
              </div>
            </div>

            <div className="flex items-center gap-space-sm sm:gap-space-lg">
              {/* Theme Mode Switcher */}
              <ThemeToggle />

              <div className="h-4 w-px bg-outline-variant"></div>

              {/* User Identity / Auth Trigger */}
              {user ? (
                <div className="flex items-center gap-space-xs sm:gap-space-md">
                  <Link href="/settings" className="hidden lg:flex flex-col items-end text-right">
                    <span className="font-body-sm font-bold text-on-surface">{user.name}</span>
                    <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant">{user.email}</span>
                  </Link>
                  <Link
                    href="/settings"
                    title="Account Settings"
                    className="w-8 h-8 rounded-full bg-surface-container-high border border-outline-variant flex items-center justify-center font-data-mono-sm text-primary font-bold hover:border-primary transition-colors shrink-0"
                  >
                    {getInitials(user.name, user.email)}
                  </Link>
                  <button
                    onClick={handleSignOut}
                    title="Sign Out"
                    className="hidden sm:inline-flex p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-surface-container-high transition-colors"
                  >
                    <span className="material-symbols-outlined text-[18px]">logout</span>
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Link
                    href="/login"
                    className="px-2.5 sm:px-3 py-1.5 rounded-lg border border-outline-variant text-body-sm font-bold text-on-surface hover:bg-surface-container-high transition-colors"
                  >
                    Sign In
                  </Link>
                  <Link
                    href="/register"
                    className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-body-sm font-bold hover:bg-primary-fixed-dim transition-colors hidden sm:inline-block"
                  >
                    Register
                  </Link>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Observatory Configuration Health Banner */}
        <ConfigBanner />

        {/* Desktop Sidebar (Instrument Directory) */}
        <aside className="hidden lg:flex fixed left-0 top-14 h-[calc(100vh-3.5rem)] w-64 bg-surface-container-lowest border-r border-surface-container z-40 flex-col justify-between py-space-md">
          <div className="flex flex-col gap-space-xs">
            <div className="px-space-lg py-space-xs">
              <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">
                Observatory Instruments
              </span>
            </div>
            <nav className="flex flex-col">
              <Link
                href="/"
                className={`flex items-center gap-space-md px-space-lg py-space-sm font-body-md text-body-md transition-colors ${
                  pathname === '/'
                    ? 'bg-surface-container text-primary font-bold border-l-2 border-primary-container'
                    : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">radar</span>
                <span>Radar Feed</span>
              </Link>
              {pathname.startsWith('/opportunities') && (
                <Link
                  href={pathname}
                  className="flex items-center gap-space-md px-space-lg py-space-sm font-body-md text-body-md transition-colors bg-surface-container text-primary font-bold border-l-2 border-primary-container"
                >
                  <span className="material-symbols-outlined text-[18px]">biotech</span>
                  <span>Active Opportunity</span>
                </Link>
              )}
              <Link
                href="/deadlines"
                className={`flex items-center gap-space-md px-space-lg py-space-sm font-body-md text-body-md transition-colors ${
                  pathname === '/deadlines'
                    ? 'bg-surface-container text-primary font-bold border-l-2 border-primary-container'
                    : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">calendar_clock</span>
                <span>Deadlines</span>
              </Link>
              <Link
                href="/profile"
                className={`flex items-center gap-space-md px-space-lg py-space-sm font-body-md text-body-md transition-colors ${
                  pathname === '/profile'
                    ? 'bg-surface-container text-primary font-bold border-l-2 border-primary-container'
                    : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">person_search</span>
                <span>Profile Calibration</span>
              </Link>
              <Link
                href="/digests"
                className={`flex items-center gap-space-md px-space-lg py-space-sm font-body-md text-body-md transition-colors ${
                  pathname === '/digests'
                    ? 'bg-surface-container text-primary font-bold border-l-2 border-primary-container'
                    : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">auto_stories</span>
                <span>Digests</span>
              </Link>
              <Link
                href="/activity"
                className={`flex items-center gap-space-md px-space-lg py-space-sm font-body-md text-body-md transition-colors ${
                  pathname === '/activity'
                    ? 'bg-surface-container text-primary font-bold border-l-2 border-primary-container'
                    : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">monitoring</span>
                <span>Activity & Governance</span>
              </Link>
              <Link
                href="/settings"
                className={`flex items-center gap-space-md px-space-lg py-space-sm font-body-md text-body-md transition-colors ${
                  pathname === '/settings'
                    ? 'bg-surface-container text-primary font-bold border-l-2 border-primary-container'
                    : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">settings</span>
                <span>Platform Settings</span>
              </Link>
            </nav>
          </div>

          <div className="px-space-lg py-space-sm border-t border-surface-container">
            <div className="flex items-center justify-between font-data-mono-sm text-data-mono-sm text-on-surface-variant">
              <span>RADAR INDEX</span>
              <span className="text-secondary font-bold">98.4%</span>
            </div>
            <div className="w-full bg-surface-container-low h-1 mt-space-xs">
              <div className="bg-secondary h-1 w-[98.4%]"></div>
            </div>
          </div>
        </aside>

        {/* Mobile Slide-Over Drawer Navigation */}
        {mobileDrawerOpen && (
          <div className="lg:hidden fixed inset-0 z-50 flex">
            <div
              className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
              onClick={() => setMobileDrawerOpen(false)}
            />
            <div className="relative z-10 w-72 max-w-[82vw] h-full bg-surface-container-lowest border-r border-surface-container flex flex-col justify-between py-space-md shadow-2xl">
              <div className="flex flex-col gap-space-xs">
                <div className="px-space-lg py-space-xs flex items-center justify-between border-b border-surface-container pb-3">
                  <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">
                    Observatory Instruments
                  </span>
                  <button
                    onClick={() => setMobileDrawerOpen(false)}
                    className="p-1 rounded text-on-surface-variant hover:text-on-surface"
                  >
                    <span className="material-symbols-outlined text-[20px]">close</span>
                  </button>
                </div>
                <nav className="flex flex-col mt-2">
                  <Link
                    href="/"
                    onClick={() => setMobileDrawerOpen(false)}
                    className={`flex items-center gap-space-md px-space-lg py-space-sm font-body-md text-body-md transition-colors ${
                      pathname === '/'
                        ? 'bg-surface-container text-primary font-bold border-l-2 border-primary-container'
                        : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">radar</span>
                    <span>Radar Feed</span>
                  </Link>
                  <Link
                    href="/deadlines"
                    onClick={() => setMobileDrawerOpen(false)}
                    className={`flex items-center gap-space-md px-space-lg py-space-sm font-body-md text-body-md transition-colors ${
                      pathname === '/deadlines'
                        ? 'bg-surface-container text-primary font-bold border-l-2 border-primary-container'
                        : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">calendar_clock</span>
                    <span>Deadlines</span>
                  </Link>
                  <Link
                    href="/profile"
                    onClick={() => setMobileDrawerOpen(false)}
                    className={`flex items-center gap-space-md px-space-lg py-space-sm font-body-md text-body-md transition-colors ${
                      pathname === '/profile'
                        ? 'bg-surface-container text-primary font-bold border-l-2 border-primary-container'
                        : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">person_search</span>
                    <span>Profile Calibration</span>
                  </Link>
                  <Link
                    href="/digests"
                    onClick={() => setMobileDrawerOpen(false)}
                    className={`flex items-center gap-space-md px-space-lg py-space-sm font-body-md text-body-md transition-colors ${
                      pathname === '/digests'
                        ? 'bg-surface-container text-primary font-bold border-l-2 border-primary-container'
                        : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">auto_stories</span>
                    <span>Digests</span>
                  </Link>
                  <Link
                    href="/activity"
                    onClick={() => setMobileDrawerOpen(false)}
                    className={`flex items-center gap-space-md px-space-lg py-space-sm font-body-md text-body-md transition-colors ${
                      pathname === '/activity'
                        ? 'bg-surface-container text-primary font-bold border-l-2 border-primary-container'
                        : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">monitoring</span>
                    <span>Activity & Governance</span>
                  </Link>
                  <Link
                    href="/settings"
                    onClick={() => setMobileDrawerOpen(false)}
                    className={`flex items-center gap-space-md px-space-lg py-space-sm font-body-md text-body-md transition-colors ${
                      pathname === '/settings'
                        ? 'bg-surface-container text-primary font-bold border-l-2 border-primary-container'
                        : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">settings</span>
                    <span>Platform Settings</span>
                  </Link>
                </nav>
              </div>

              <div className="px-space-lg py-space-sm border-t border-surface-container flex flex-col gap-2">
                {user && (
                  <div className="flex items-center justify-between pb-2 border-b border-surface-container">
                    <div className="flex flex-col min-w-0">
                      <span className="font-body-sm font-bold text-on-surface truncate">{user.name}</span>
                      <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant truncate">{user.email}</span>
                    </div>
                    <button
                      onClick={handleSignOut}
                      title="Sign Out"
                      className="p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-surface-container-high transition-colors"
                    >
                      <span className="material-symbols-outlined text-[18px]">logout</span>
                    </button>
                  </div>
                )}
                <div className="flex items-center justify-between font-data-mono-sm text-data-mono-sm text-on-surface-variant">
                  <span>RADAR INDEX</span>
                  <span className="text-secondary font-bold">98.4%</span>
                </div>
                <div className="w-full bg-surface-container-low h-1 mt-space-2xs">
                  <div className="bg-secondary h-1 w-[98.4%]"></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Main Viewport Container */}
        <div className="pl-0 lg:pl-64 pb-20 lg:pb-0">
          <main className="relative pt-14 min-h-screen">
            {children}
          </main>
        </div>

        {/* Mobile Bottom Navigation Bar (Stitch Design System Spec) */}
        <nav
          className="lg:hidden fixed bottom-0 inset-x-0 z-40 pb-safe bg-surface/95 backdrop-blur-xl border-t border-surface-container shadow-[0_-1px_12px_rgba(0,0,0,0.25)]"
          data-active-classes="text-primary"
        >
          <div className="grid grid-cols-6 items-center h-16 px-space-2xs">
            <Link
              href="/"
              aria-current={pathname === '/' ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-space-2xs h-full w-full transition-colors py-space-2xs ${
                pathname === '/' ? 'text-primary font-bold' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">radar</span>
              <span className="font-label-caps text-[10px] tracking-tighter truncate">Radar</span>
            </Link>
            <Link
              href="/deadlines"
              aria-current={pathname === '/deadlines' ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-space-2xs h-full w-full transition-colors py-space-2xs ${
                pathname === '/deadlines' ? 'text-primary font-bold' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">schedule</span>
              <span className="font-label-caps text-[10px] tracking-tighter truncate">Deadlines</span>
            </Link>
            <Link
              href={pathname.startsWith('/opportunities/') ? pathname : '/'}
              aria-current={pathname.startsWith('/opportunities/') ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-space-2xs h-full w-full transition-colors py-space-2xs ${
                pathname.startsWith('/opportunities/') ? 'text-primary font-bold' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">biotech</span>
              <span className="font-label-caps text-[10px] tracking-tighter truncate">Detail</span>
            </Link>
            <Link
              href="/digests"
              aria-current={pathname === '/digests' ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-space-2xs h-full w-full transition-colors py-space-2xs ${
                pathname === '/digests' ? 'text-primary font-bold' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">menu_book</span>
              <span className="font-label-caps text-[10px] tracking-tighter truncate">Digests</span>
            </Link>
            <Link
              href="/activity"
              aria-current={pathname === '/activity' ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-space-2xs h-full w-full transition-colors py-space-2xs ${
                pathname === '/activity' ? 'text-primary font-bold' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">analytics</span>
              <span className="font-label-caps text-[10px] tracking-tighter truncate">Activity</span>
            </Link>
            <Link
              href="/profile"
              aria-current={pathname === '/profile' ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-space-2xs h-full w-full transition-colors py-space-2xs ${
                pathname === '/profile' ? 'text-primary font-bold' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">account_balance</span>
              <span className="font-label-caps text-[10px] tracking-tighter truncate">Profile</span>
            </Link>
          </div>
        </nav>
      </>
    )}
    </>
  );
}
