'use client';

import { useEffect, useRef, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

export type ThemePreference = 'light' | 'dark' | 'system';
export const THEME_STORAGE_KEY = 'interpretes-rd-theme';
const SYSTEM_QUERY = '(prefers-color-scheme: dark)';

export function normalizeThemePreference(value: string | null): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

function storedPreference(): ThemePreference {
  try {
    return normalizeThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Storage can be blocked in privacy modes; switching must still work.
    return 'system';
  }
}

function isSystemDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(SYSTEM_QUERY).matches;
}

export function applyTheme(preference: ThemePreference) {
  const dark = preference === 'dark' || (preference === 'system' && isSystemDark());
  const theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function ThemeSwitcher() {
  const [preference, setPreference] = useState<ThemePreference>('system');
  const preferenceRef = useRef<ThemePreference>('system');

  useEffect(() => {
    const current = storedPreference();
    preferenceRef.current = current;
    setPreference(current);
    applyTheme(current);

    const media = typeof window.matchMedia === 'function' ? window.matchMedia(SYSTEM_QUERY) : null;
    const onSystemChange = () => {
      if (preferenceRef.current === 'system') applyTheme('system');
    };
    media?.addEventListener?.('change', onSystemChange);

    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const next = normalizeThemePreference(event.newValue);
      preferenceRef.current = next;
      setPreference(next);
      applyTheme(next);
    };
    window.addEventListener('storage', onStorage);

    return () => {
      media?.removeEventListener?.('change', onSystemChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const selectTheme = (mode: ThemePreference) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // Keep the UI usable without persistence.
    }
    preferenceRef.current = mode;
    setPreference(mode);
    applyTheme(mode);
  };

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
          onClick={() => selectTheme(mode)}
          className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${preference === mode ? 'bg-[#083b83] text-white shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--theme-hover)]'}`}
        >
          <Icon size={16} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
