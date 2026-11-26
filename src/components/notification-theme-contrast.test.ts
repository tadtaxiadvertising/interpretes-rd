// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
function tokens(pattern: RegExp) {
  return Object.fromEntries([...css.matchAll(pattern)].flatMap(block =>
    [...block[1].matchAll(/(--[\w-]+):\s*(#[\da-fA-F]{6}|#[\da-fA-F]{3})\s*;/g)].map(match => [match[1], match[2]])));
}
const dark = tokens(/(?:^|\n):root\s*\{([^}]*)\}/g);
const light = { ...dark, ...tokens(/(?:^|\n)html\[data-theme="light"\]\s*\{([^}]*)\}/g) };
function luminance(hex: string) {
  const value = hex.slice(1);
  const full = value.length === 3 ? [...value].map(c => c + c).join('') : value;
  const components = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return components[0] * 0.2126 + components[1] * 0.7152 + components[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

describe('notification theme token contrast', () => {
  it.each([['dark', dark], ['light', light]] as const)('keeps normal text and control indicators legible in %s', (_name, palette) => {
    for (const surface of ['--theme-panel', '--theme-surface-muted']) {
      for (const foreground of ['--foreground', '--text-secondary', '--theme-link', '--theme-warning', '--theme-danger']) {
        expect(contrast(palette[foreground], palette[surface]), foreground + ' on ' + surface).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(palette['--theme-focus'], palette[surface])).toBeGreaterThanOrEqual(3);
      expect(contrast(palette['--theme-link'], palette[surface])).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(palette['--theme-control-text'], palette['--theme-control-bg'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette['--theme-control-border'], palette['--theme-control-bg'])).toBeGreaterThanOrEqual(3);
  });
});
