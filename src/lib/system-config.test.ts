import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const m = vi.hoisted(() => ({
  findUnique: vi.fn(),
  unstableCache: vi.fn((cb: (...args: unknown[]) => unknown) => cb),
}));

vi.mock('next/cache', () => ({
  unstable_cache: m.unstableCache,
}));
vi.mock('@/lib/prisma', () => ({
  default: { systemConfig: { findUnique: m.findUnique } },
}));
vi.mock('@/lib/security/safe-server-error', () => ({
  safeServerErrorCategory: vi.fn(() => 'DatabaseError'),
}));

import { getSystemConfig } from './system-config';

describe('private SystemConfig reader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads an internal configuration key without publishing it as a Server Action', async () => {
    m.findUnique.mockResolvedValueOnce({ value: '0.35' });
    expect(await getSystemConfig('ranking_weight_qa', '0.30')).toBe('0.35');
    expect(m.findUnique).toHaveBeenCalledWith({
      where: { key: 'ranking_weight_qa' },
      select: { value: true },
    });
  });

  it('returns a default when no configuration row exists', async () => {
    m.findUnique.mockResolvedValueOnce(null);
    expect(await getSystemConfig('standard_monthly_goal_hours', '120')).toBe('120');
  });

  it('fails safely with a default and no exposed provider error', async () => {
    m.findUnique.mockRejectedValueOnce(new Error('postgresql://db:SECRET@private.invalid/postgres'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await getSystemConfig('ranking_weight_qa', '0.30')).toBe('0.30');
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/SECRET|private\.invalid|postgresql:/);
    } finally {
      log.mockRestore();
    }
  });

  it('registers the existing cache tag and one-hour fallback expiry', () => {
    expect(m.unstableCache).toHaveBeenCalledWith(
      expect.any(Function),
      ['system-config'],
      { tags: ['system-config'], revalidate: 3600 },
    );
  });

  it('keeps arbitrary reads outside the exported Server Actions module', () => {
    const actions = readFileSync('src/app/actions/settings.ts', 'utf8');
    const reader = readFileSync('src/lib/system-config.ts', 'utf8');
    expect(actions.trimStart()).toMatch(/^'use server';/);
    expect(actions).toContain("validateAction('admin')");
    expect(actions).not.toMatch(/export\s+(?:async\s+)?function\s+getSystemConfig/);
    expect(reader).not.toMatch(/^\s*['"]use server['"]/m);
    expect(reader).toContain('export async function getSystemConfig');
    for (const page of [
      'src/lib/ranking/calculate.ts',
      'src/app/dashboard/page.tsx',
      'src/app/admin/page.tsx',
    ]) {
      const source = readFileSync(page, 'utf8');
      expect(source).toContain("from '@/lib/system-config'");
      expect(source).not.toContain("from '@/app/actions/settings'");
    }
  });
});
