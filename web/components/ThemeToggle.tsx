'use client';

import { useTheme } from './ThemeProvider';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="w-20 h-7 rounded-full bg-surface-container-high animate-pulse"></div>
    );
  }

  const cycleTheme = () => {
    if (theme === 'system') setTheme('light');
    else if (theme === 'light') setTheme('dark');
    else setTheme('system');
  };

  return (
    <div className="flex items-center rounded-full bg-surface-container-high border border-outline-variant/40 p-0.5">
      <button
        type="button"
        title="Light Mode"
        onClick={() => setTheme('light')}
        className={`px-2 py-1 rounded-full text-[12px] flex items-center gap-1 transition-all ${
          theme === 'light'
            ? 'bg-primary text-on-primary font-bold shadow-sm'
            : 'text-on-surface-variant hover:text-on-surface'
        }`}
      >
        <span className="material-symbols-outlined text-[14px]">light_mode</span>
        <span className="hidden sm:inline">Light</span>
      </button>

      <button
        type="button"
        title="Dark Mode"
        onClick={() => setTheme('dark')}
        className={`px-2 py-1 rounded-full text-[12px] flex items-center gap-1 transition-all ${
          theme === 'dark'
            ? 'bg-primary text-on-primary font-bold shadow-sm'
            : 'text-on-surface-variant hover:text-on-surface'
        }`}
      >
        <span className="material-symbols-outlined text-[14px]">dark_mode</span>
        <span className="hidden sm:inline">Dark</span>
      </button>

      <button
        type="button"
        title="Follow System Theme"
        onClick={() => setTheme('system')}
        className={`px-2 py-1 rounded-full text-[12px] flex items-center gap-1 transition-all ${
          theme === 'system'
            ? 'bg-primary text-on-primary font-bold shadow-sm'
            : 'text-on-surface-variant hover:text-on-surface'
        }`}
      >
        <span className="material-symbols-outlined text-[14px]">settings_brightness</span>
        <span className="hidden sm:inline">Auto</span>
      </button>
    </div>
  );
}
