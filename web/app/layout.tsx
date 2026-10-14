import '@/styles/tokens.css';
import type { Metadata, Viewport } from 'next';
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
    { media: '(prefers-color-scheme: light)', color: '#F5F6F8' },
    { media: '(prefers-color-scheme: dark)', color: '#0E1117' }
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
          href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:ital,wght@0,400..800;1,400..800&display=swap"
          rel="stylesheet"
        />
        {/* One fixed style (the defaults the UI uses): 324 KB instead of 4 MB for the adjustable font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=block"
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
      <body className="bg-background font-body-md text-on-surface antialiased " suppressHydrationWarning>
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
