// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import StatusBadge from './StatusBadge';
import { PresenceBadge } from './PresenceBadge';
import { StatusToggle } from './StatusToggle';

let presence: 'loading' | 'online' | 'offline' = 'loading';
vi.mock('@/contexts/PresenceContext', () => ({ usePresenceContext: () => presence }));

afterEach(() => {
  cleanup();
  presence = 'loading';
});

describe('shared presence indicators', () => {
  it.each([
    ['Online', 'Online', '--theme-success'],
    ['Busy', 'Busy', '--theme-warning'],
    ['Away', 'Ausente', '--theme-away'],
    ['Offline', 'Offline', '--text-secondary'],
    ['constructor', 'Offline', '--text-secondary'],
  ])('renders %s with a readable semantic label', (status, label, token) => {
    render(<StatusBadge status={status} showTime={false} />);
    const badge = screen.getByText(label).parentElement;
    expect(badge?.className).toContain('text-[var(' + token + ')]');
    expect(badge?.className).toContain('bg-[var(--theme-surface-muted)]');
    expect(badge?.querySelector('[aria-hidden="true"].bg-current')).toBeTruthy();
  });

  it('does not fade the activity timestamp', () => {
    render(<StatusBadge status="Online" lastHeartbeat={new Date(Date.now() - 61000)} />);
    const time = screen.getByText('1min');
    expect(time.className).toContain('text-[var(--text-secondary)]');
    expect(time.className).not.toContain('opacity-50');
  });

  it.each([
    ['loading', 'Detectando…', '--text-secondary'],
    ['online', 'Online', '--theme-success'],
    ['offline', 'Offline', '--text-secondary'],
  ] as const)('keeps the interpreter presence %s readable', (state, label, token) => {
    presence = state;
    render(<PresenceBadge />);
    const badge = screen.getByText(label);
    expect(badge.className).toContain('text-[var(' + token + ')]');
    expect(badge.className).toContain('bg-[var(--theme-surface-muted)]');
  });

  it.each([
    ['Online', '--theme-success'],
    ['Busy', '--theme-warning'],
    ['Offline', '--text-secondary'],
  ])('uses the same status color for %s in the read-only toggle', (state, token) => {
    render(<StatusToggle currentStatus={state} />);
    expect(screen.getByText(state).className).toContain('text-[var(' + token + ')]');
  });

  it('keeps status and timestamp text at least 4.5:1 on the muted surface in both themes', () => {
    const css = postcss.parse(readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8'));
    const luminance = (hex: string) => {
      expect(hex).toMatch(/^#[a-f\d]{6}$/i);
      const rgb = [1, 3, 5].map(i => {
        const n = parseInt(hex.slice(i, i + 2), 16) / 255;
        return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
      });
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    for (const selector of [':root', 'html[data-theme="light"]']) {
      const tokens = new Map<string, string>();
      css.walkRules(selector, rule => {
        rule.walkDecls(/^--/, declaration => {
          tokens.set(declaration.prop, declaration.value);
        });
      });
      const background = luminance(tokens.get('--theme-surface-muted') ?? '');
      for (const token of ['--theme-success', '--theme-warning', '--theme-away', '--text-secondary']) {
        const foreground = luminance(tokens.get(token) ?? '');
        expect((Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
