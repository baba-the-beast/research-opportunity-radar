'use client';

import '@/styles/tokens.css';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ConfigBanner } from '@/components/ConfigBanner';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <html className="dark" lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link
          href="https://fonts.googleapis.com/css2?family=Libre+Caslon+Text:ital,wght@0,400;0,700;1,400&family=Public+Sans:ital,wght@0,300..800;1,300..800&family=Space+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
          rel="stylesheet"
        />
      </head>
      <body className="bg-background font-body-md text-on-surface antialiased selection:bg-primary-container selection:text-on-primary-container">
        {/* Top Header */}
        <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-surface-container-lowest/90 backdrop-blur-md border-b border-surface-container">
          <div className="h-14 w-full px-space-xl flex items-center justify-between">
            <div className="flex items-center gap-space-lg">
              <div className="flex items-center gap-space-md">
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
              </div>
              <div className="h-4 w-px bg-outline-variant"></div>
              <div className="flex items-center gap-space-xs font-data-mono-sm text-data-mono-sm text-on-surface-variant">
                <span className="w-1.5 h-1.5 rounded-full bg-primary-container inline-block animate-pulse"></span>
                <span>last scanned: 2 days ago</span>
              </div>
            </div>
            <div className="flex items-center gap-space-lg">
              <div className="flex items-center gap-space-sm font-data-mono-sm text-data-mono-sm text-on-surface-variant">
                <span className="material-symbols-outlined text-[16px] text-secondary">sensors</span>
                <span className="tracking-wider uppercase font-bold">Telemetry Active</span>
              </div>
              <div className="h-4 w-px bg-outline-variant"></div>
              <div className="flex items-center gap-space-md">
                <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant">FACULTY REF: #9104-ASTRO</span>
                <div className="w-8 h-8 rounded-full bg-surface-container-high border border-outline-variant flex items-center justify-center font-data-mono-sm text-primary font-bold">
                  VT
                </div>
              </div>
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
              <Link
                href="/opportunities/tcps-2025-0881"
                className={`flex items-center gap-space-md px-space-lg py-space-sm font-body-md text-body-md transition-colors ${
                  pathname.startsWith('/opportunities')
                    ? 'bg-surface-container text-primary font-bold border-l-2 border-primary-container'
                    : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">biotech</span>
                <span>Opportunity Detail</span>
              </Link>
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
      </body>
    </html>
  );
}
