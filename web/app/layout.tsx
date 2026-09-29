import '@/styles/tokens.css';
import type { Metadata, Viewport } from 'next';
import { AppBackground } from '@/components/AppBackground';
import { AppShell } from '@/components/AppShell';
import { ThemeProvider } from '@/components/ThemeProvider';

export const metadata: Metadata = {
  title: {
    default: 'Research Opportunity Radar',
    template: '%s · Research Opportunity Radar'
  },
  description:
    'Autonomous multi-agent watch for research funding calls, journal special issues and conference deadlines, scored against your research profile.'
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F9F8F5' },
    { media: '(prefers-color-scheme: dark)', color: '#0f141a' }
  ]
};

/**
 * Server root layout. Interactive chrome lives in AppShell (client); this file owns the document,
 * metadata and the pre-hydration theme script, so pages render without waiting on client JS.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Libre+Caslon+Text:ital,wght@0,400;0,700;1,400&family=Public+Sans:ital,wght@0,300..800;1,300..800&family=Space+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
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
          <AppBackground>
            <AppShell>{children}</AppShell>
          </AppBackground>
        </ThemeProvider>
      </body>
    </html>
  );
}
