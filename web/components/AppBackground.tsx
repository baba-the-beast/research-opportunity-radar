'use client';

import { useEffect, useState } from 'react';
import KineticGrid from '@/components/ui/kinetic-grid';

function htmlIsLight(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('light');
}

/**
 * App-wide interactive background, matched to the light/dark tokens in styles/tokens.css.
 *
 * Follows the <html> class rather than useTheme(): the inline script in layout.tsx sets that class
 * before hydration, while ThemeProvider reports 'dark' until its effect runs, which would paint one
 * dark frame for light-mode users. overflow-visible keeps sticky descendants (ConfigBanner) working.
 */
export function AppBackground({ children }: { children: React.ReactNode }) {
  const [light, setLight] = useState(htmlIsLight);

  useEffect(() => {
    const observer = new MutationObserver(() => setLight(htmlIsLight()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    setLight(htmlIsLight());
    return () => observer.disconnect();
  }, []);

  return (
    <KineticGrid globalColor={light ? 'radar-light' : 'radar-dark'} className="overflow-visible">
      {children}
    </KineticGrid>
  );
}
