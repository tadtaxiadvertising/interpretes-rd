'use client';

import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

type ThemePreference = 'light' | 'dark' | 'system';
const KEY = 'interpretes-rd-theme';

function applyTheme(preference: ThemePreference) {
  const dark = preference === 'dark' ||
    (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

export function ThemeSwitcher() {
  const [preference, setPreference] = useState<ThemePreference>('system');

  useEffect(() => {
    const stored = window.localStorage.getItem(KEY);
    const current: ThemePreference = stored === 'light' || stored === 'dark' ? stored : 'system';
    setPreference(current);
    applyTheme(current);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => { if ((window.localStorage.getItem(KEY) || 'system') === 'system') applyTheme('system'); };
    media.addEventListener('change', onSystemChange);
    const onStorage = (event: StorageEvent) => {
      if (event.key === KEY) {
        const next = event.newValue === 'light' || event.newValue === 'dark' ? event.newValue : 'system';
        setPreference(next);
        applyTheme(next);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      media.removeEventListener('change', onSystemChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return (
    <div className="flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--card-bg)] p-1" role="group" aria-label="Apariencia de la plataforma">
      {([
        ['light', Sun, 'Modo claro'],
        ['dark', Moon, 'Modo oscuro'],
        ['system', Monitor, 'Seguir sistema'],
      ] as const).map(([mode, Icon, label]) => (
        <button
          key={mode}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={preference === mode}
          onClick={() => {
            window.localStorage.setItem(KEY, mode);
            setPreference(mode);
            applyTheme(mode);
          }}
          className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${preference === mode ? 'bg-[#083b83] text-white shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--theme-hover)]'}`}
        >
          <Icon size={16} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
