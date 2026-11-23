import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeSwitcher, THEME_STORAGE_KEY, normalizeThemePreference } from './ThemeSwitcher';

describe('ThemeSwitcher', () => {
  let systemDark = false;
  let mediaListeners: Array<() => void>;

  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.removeProperty('color-scheme');
    systemDark = false;
    mediaListeners = [];
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      get matches() { return systemDark; },
      media: '(prefers-color-scheme: dark)',
      addEventListener: (_name: string, callback: () => void) => { mediaListeners.push(callback); },
      removeEventListener: (_name: string, callback: () => void) => {
        mediaListeners = mediaListeners.filter((listener) => listener !== callback);
      },
    })));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('normalizes invalid or deleted preference to system mode', () => {
    expect(normalizeThemePreference('purple')).toBe('system');
    expect(normalizeThemePreference(null)).toBe('system');
    expect(normalizeThemePreference('dark')).toBe('dark');
  });

  it('switches between light and dark and persists the choice', () => {
    render(<ThemeSwitcher />);

    fireEvent.click(screen.getByRole('button', { name: 'Modo oscuro' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(screen.getByRole('button', { name: 'Modo oscuro' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Modo claro' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('restores an explicit preference on mount', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(<ThemeSwitcher />);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'Modo oscuro' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('follows changes in operating-system appearance only when configured as system', () => {
    render(<ThemeSwitcher />);
    expect(document.documentElement.dataset.theme).toBe('light');

    systemDark = true;
    act(() => mediaListeners.forEach((listener) => listener()));
    expect(document.documentElement.dataset.theme).toBe('dark');

    fireEvent.click(screen.getByRole('button', { name: 'Modo claro' }));
    systemDark = false;
    act(() => mediaListeners.forEach((listener) => listener()));
    systemDark = true;
    act(() => mediaListeners.forEach((listener) => listener()));
    expect(document.documentElement.dataset.theme).toBe('light');

    fireEvent.click(screen.getByRole('button', { name: 'Seguir sistema' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('synchronizes appearance changes made in another browser tab', () => {
    render(<ThemeSwitcher />);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: THEME_STORAGE_KEY, newValue: 'dark',
      }));
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'Modo oscuro' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('works when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    render(<ThemeSwitcher />);
    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'Modo oscuro' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
