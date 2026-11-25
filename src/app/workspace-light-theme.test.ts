import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';

const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
const patch = css.split('/* Light workspace: exact legacy utilities')[1]?.split('/* Light portal controls:')[0];
const root = postcss.parse(css);
const lightTokens = new Map<string, string>();
root.walkRules('html[data-theme="light"]', rule => {
  rule.walkDecls(/^--/, declaration => {
    lightTokens.set(declaration.prop, declaration.value);
  });
});

function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const value = hex === '#fff' ? '#ffffff' : hex;
    const channels = [1, 3, 5].map(index => {
      const n = parseInt(value.slice(index, index + 2), 16) / 255;
      return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe('light workspace compatibility', () => {
  it('covers exact legacy surfaces and status colors from the three admin modules', () => {
    expect(patch).toBeDefined();
    for (const name of [
      'bg-slate-950/70', 'bg-slate-950/80', 'bg-gray-900/95', 'bg-gray-800/60',
      'bg-gray-950/60', 'text-blue-100/70', 'text-amber-200/80', 'text-cyan-200/80',
      'text-red-200', 'text-teal-100', 'text-violet-100', 'text-orange-400',
      'hover:bg-white/10', 'hover:text-white',
    ]) {
      expect(patch).toContain(`[class~="${name}"]`);
    }
    expect(patch).not.toContain('[class~="bg-black"]');
  });

  it('keeps every added compatibility rule scoped to the light workspace', () => {
    const added = postcss.parse('/* Light workspace: exact legacy utilities' + patch);
    added.walkRules(rule => {
      for (const selector of rule.selectors) {
        expect(selector.trim().startsWith('html[data-theme="light"] .theme-workspace')).toBe(true);
      }
    });
  });

  it('keeps shared text and semantic status tokens above 4.5:1 on neutral surfaces', () => {
    for (const token of ['--foreground', '--text-secondary', '--theme-link',
      '--theme-success', '--theme-warning', '--theme-danger', '--theme-purple',
      '--theme-away', '--theme-info', '--text-tertiary']) {
      for (const surface of ['--theme-panel', '--theme-surface-muted']) {
        expect(contrast(lightTokens.get(token)!, lightTokens.get(surface)!)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps solid action button colors above 4.5:1 against white text', () => {
    const colors: string[] = [];
    root.walkRules(rule => {
      if (rule.selector.includes('.text-white') && rule.selector.includes('[class~="bg-cyan-500"]')
        || rule.selector.includes('.text-white') && /\[class~="bg-(blue|red|emerald|green|indigo|violet|purple|teal)-500"\]/.test(rule.selector)) {
        rule.walkDecls('background-color', declaration => {
          if (/^#[0-9a-f]{6}$/i.test(declaration.value)) colors.push(declaration.value);
        });
      }
    });
    expect(new Set(colors).size).toBeGreaterThanOrEqual(7);
    for (const color of colors) expect(contrast(color, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('light dashboard action contrast', () => {
  it('keeps call gradient endpoints readable, including hover', () => {
    for (const color of ['#065f46', '#047857', '#064e3b', '#991b1b', '#b91c1c', '#7f1d1d', '#1554a8', '#002d72']) {
      expect(contrast(color, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    }
    expect(css).toContain('linear-gradient(90deg, #065f46, #047857)');
    expect(css).toContain('linear-gradient(90deg, #991b1b, #b91c1c)');
    expect(css).toContain('input[type="file"][class~="file:bg-blue-600"]::file-selector-button');
    expect(css).toContain('[class~="bg-slate-950/55"].fixed.inset-0 { background-color: rgba(15, 23, 42, .55); }');
  });
});

describe('light portal interactive states', () => {
  it('keeps login and recruitment action colors readable', () => {
    for (const color of ['#002d72', '#1554a8', '#002452', '#12488f']) {
      expect(contrast(color, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast('#43546d', '#e2e8f0')).toBeGreaterThanOrEqual(4.5);
    expect(css).toContain('.theme-login button[type="submit"].from-blue-600.to-blue-500:hover');
    expect(css).toContain('.theme-postular .recruitment-funnel button[class~="disabled:bg-slate-400"]:disabled');
    expect(css).toContain('.theme-workspace [class~="hover:bg-slate-800/80"]:hover');
  });
});

describe('semantic monitoring palette', () => {
  it('keeps the away and informational states distinct and legible in both themes', () => {
    const darkTokens = new Map<string, string>();
    root.walkRules(':root', rule => {
      rule.walkDecls(/^--/, declaration => {
        darkTokens.set(declaration.prop, declaration.value);
      });
    });
    for (const tokens of [darkTokens, lightTokens]) {
      expect(tokens.get('--theme-away')).not.toBe(tokens.get('--theme-warning'));
      for (const token of ['--theme-away', '--theme-info']) {
        for (const surface of ['--theme-panel', '--theme-surface-muted']) {
          expect(contrast(tokens.get(token)!, tokens.get(surface)!)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('keeps portal-specific compatibility rules within the light theme', () => {
    const portal = css.split('/* Light portal controls:')[1];
    expect(portal).toBeDefined();
    postcss.parse('/* Light portal controls:' + portal).walkRules(rule => {
      for (const selector of rule.selectors) {
        expect(selector.trim()).toMatch(/^html\[data-theme="light"\] \.theme-(workspace|login|candidate|postular)\b/);
      }
    });
  });
});

describe('Audio Studio semantic theme', () => {
  it('uses theme-aware controls and preserves the video surface and solid actions', () => {
    const studio = readFileSync(resolve(process.cwd(), 'src/app/admin/roleplays/studio/page.tsx'), 'utf8');
    expect(studio).toContain('bg-[var(--theme-control-bg)]');
    expect(studio).toContain('text-[var(--theme-control-text)]');
    expect(studio).toContain('border-[var(--theme-control-border)]');
    expect(studio).toContain('rounded-lg bg-black');
    expect(studio).toContain('bg-blue-600 px-4 py-3 font-semibold text-white');
  });

  it('uses theme colors for the waveform, selection and playhead', () => {
    const waveform = readFileSync(resolve(process.cwd(), 'src/app/admin/roleplays/studio/StudioWaveform.tsx'), 'utf8');
    expect(waveform).toContain('fill-[var(--theme-link)]');
    expect(waveform).toContain('fill-[var(--theme-success)] opacity-25');
    expect(waveform).toContain('stroke-[var(--theme-warning)]');
    expect(waveform).toContain('bg-[var(--theme-surface-muted)]');
  });
});
