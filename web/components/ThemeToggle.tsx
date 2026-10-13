'use client';

import { useTheme } from './ThemeProvider';
import { useEffect, useState } from 'react';

const NEXT = { system: 'light', light: 'dark', dark: 'system' } as const;
const META = {
  light: { icon: 'light_mode', label: 'Light' },
  dark: { icon: 'dark_mode', label: 'Dark' },
  system: { icon: 'contrast', label: 'Match device' }
} as const;

/** One button that cycles light → dark → match device. The full choice also lives in Settings. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const size = 'inline-flex items-center justify-center w-11 h-11 sm:w-9 sm:h-9 rounded-lg';
  if (!mounted) return <span className={size} aria-hidden="true" />;

  const current = META[theme];
  const next = META[NEXT[theme]];
  return (
    <button
      type="button"
      onClick={() => setTheme(NEXT[theme])}
      title={`Theme: ${current.label}. Switch to ${next.label.toLowerCase()}`}
      aria-label={`Theme: ${current.label}. Switch to ${next.label.toLowerCase()}`}
      className={`${size} text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors`}
    >
      <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
        {current.icon}
      </span>
    </button>
  );
}
