import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { themeBootstrapScript } from './theme-bootstrap';

function initializeTheme(
  preference: string | null,
  systemDark: boolean,
  opts: { blockStorage?: boolean; unavailableMatchMedia?: boolean } = {}
) {
  const root = { dataset: {} as Record<string, string>, style: { colorScheme: '' } };
  const env = {
    window: {
      localStorage: {
        getItem: (_key: string) => {
          if (opts.blockStorage) throw new Error('Storage denied');
          return preference;
        },
      },
      ...(!opts.unavailableMatchMedia && {
        matchMedia: (_query: string) => ({ matches: systemDark }),
      }),
    },
    document: { documentElement: root },
  };

  expect(() => runInNewContext(themeBootstrapScript, env)).not.toThrow();
  return root;
}

describe('pre-paint theme bootstrap', () => {
  it('respects explicit light and dark even if the system prefers another setting', () => {
    expect(initializeTheme('light', true).dataset.theme).toBe('light');
    expect(initializeTheme('dark', false).dataset.theme).toBe('dark');
  });

  it('uses the operating system when storage is blocked', () => {
    expect(initializeTheme(null, true, { blockStorage: true }).dataset.theme).toBe('dark');
    expect(initializeTheme(null, false, { blockStorage: true }).dataset.theme).toBe('light');
  });

  it('keeps explicit preference when matchMedia is unavailable', () => {
    const root = initializeTheme('dark', false, { unavailableMatchMedia: true });
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
  });

  it('defaults to light when neither a preference nor system matchMedia exists', () => {
    const root = initializeTheme(null, false, { blockStorage: true, unavailableMatchMedia: true });
    expect(root.dataset.theme).toBe('light');
    expect(root.style.colorScheme).toBe('light');
  });
});
