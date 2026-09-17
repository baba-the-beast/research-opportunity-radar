'use client';

import '@/styles/tokens.css';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ConfigBanner } from '@/components/ConfigBanner';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowserClient';

const AUTH_PATHS = new Set([
  '/login',
  '/register',
  '/verify-email',
  '/forgot-password',
  '/reset-password'
]);

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isAuthPage = AUTH_PATHS.has(pathname);

  const [user, setUser] = useState<{ id: string; email?: string; name?: string } | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Libre+Caslon+Text:ital,wght@0,400;0,700;1,400&family=Public+Sans:ital,wght@0,300..800;1,300..800&family=Space+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
          rel="stylesheet"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var stored = localStorage.getItem('radar-theme');
                  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  var isDark = stored === 'dark' || (stored !== 'light' && prefersDark);
                  if (isDark) {
                    document.documentElement.classList.add('dark');
                    document.documentElement.classList.remove('light');
                  } else {
                    document.documentElement.classList.remove('dark');
                    document.documentElement.classList.add('light');
                  }
                } catch(e) {}
              })();
            `
          }}
        />
      </head>
      <body className="bg-background font-body-md text-on-surface antialiased selection:bg-primary-container selection:text-on-primary-container" suppressHydrationWarning>
        <ThemeProvider>
          {isAuthPage ? (
            <main className="min-h-screen bg-background">{children}</main>
          ) : (
            <>
              {/* Top Header */}
              <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-surface-container-lowest/90 backdrop-blur-md border-b border-surface-container">
                <div className="h-14 w-full px-space-xl flex items-center justify-between">
                  <div className="flex items-center gap-space-lg">
                    <Link href="/" className="flex items-center gap-space-md">
                      <svg className="w-6 h-6 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
                        <circle cx="16" cy="16" r="14" stroke="#C08A3E" strokeWidth="1.5" strokeDasharray="2 2" opacity="0.6"/>
                        <circle cx="16" cy="16" r="8" stroke="#C08A3E" strokeWidth="1.5" opacity="0.8"/>
                        <circle cx="16" cy="16" r="2.5" fill="#C08A3E"/>
                        <line x1="16" y1="16" x2="27" y2="9" stroke="#C08A3E" strokeWidth="1.5" strokeLinecap="round"/>
                        <circle cx="23" cy="11" r="1.5" fill="#5B8C7B"/>
                      </svg>
                      <span className="font-headline-sm text-headline-sm text-on-surface tracking-tight">
                        Research Opportunity Radar
                      </span>
                    </Link>
                    <div className="h-4 w-px bg-outline-variant hidden sm:block"></div>
                    <div className="hidden md:flex items-center gap-space-xs font-data-mono-sm text-data-mono-sm text-on-surface-variant">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary-container inline-block animate-pulse"></span>
                      <span>autonomous multi-agent watch</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-space-md sm:gap-space-lg">
                    {/* Theme Mode Switcher */}
                    <ThemeToggle />

                    <div className="h-4 w-px bg-outline-variant"></div>

                    {/* User Identity / Auth Trigger */}
                    {user ? (
                      <div className="flex items-center gap-space-md">
                        <Link href="/settings" className="hidden lg:flex flex-col items-end text-right">
                          <span className="font-body-sm font-bold text-on-surface">{user.name}</span>
                          <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant">{user.email}</span>
                        </Link>
                        <Link
                          href="/settings"
                          title="Account Settings"
                          className="w-8 h-8 rounded-full bg-surface-container-high border border-outline-variant flex items-center justify-center font-data-mono-sm text-primary font-bold hover:border-primary transition-colors"
                        >
                          {getInitials(user.name, user.email)}
                        </Link>
                        <button
                          onClick={handleSignOut}
                          title="Sign Out"
                          className="p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-surface-container-high transition-colors"
                        >
                          <span className="material-symbols-outlined text-[18px]">logout</span>
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Link
                          href="/login"
                          className="px-3 py-1.5 rounded-lg border border-outline-variant text-body-sm font-bold text-on-surface hover:bg-surface-container-high transition-colors"
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

              {/* Sidebar */}
              <aside className="fixed left-0 top-14 h-[calc(100vh-3.5rem)] w-64 bg-surface-container-lowest border-r border-surface-container z-40 flex flex-col justify-between py-space-md">
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

              {/* Main Viewport */}
              <div className="pl-64">
                <main className="relative pt-14 min-h-screen bg-background">
                  {children}
                </main>
              </div>
            </>
          )}
        </ThemeProvider>
      </body>
    </html>
  );
}
