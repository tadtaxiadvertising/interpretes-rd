// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: {
    roleplaySession: {
      count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn(),
    },
  },
}));
vi.mock('@/components/admin/SessionActions', () => ({
  SessionActions: () => null,
}));

import prisma from '@/lib/prisma';
import AdminRoleplaysPage from './page';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.roleplaySession.count).mockResolvedValue(0);
  vi.mocked(prisma.roleplaySession.groupBy).mockResolvedValue([] as never);
  vi.mocked(prisma.roleplaySession.findMany).mockResolvedValue([]);
});

describe('Roleplay administration in both themes', () => {
  it('uses semantic colors and legible filters, metrics and empty state', async () => {
    const html = renderToStaticMarkup(await AdminRoleplaysPage({
      searchParams: Promise.resolve({}),
    }));

    expect(html).toContain('Gestión de roleplays');
    expect(html).toContain('text-[var(--foreground)]');
    expect(html).toContain('text-[var(--text-secondary)]');
    expect(html).toContain('bg-[var(--theme-control-bg)]');
    expect(html).toContain('border-[var(--theme-control-border)]');
    expect(html).toContain('name="search"');
    expect(html).toContain('name="status"');
    expect(html).toContain('name="participantType"');
    expect(html).toContain('Todavía no hay sesiones de roleplay');
    expect(html).toContain('value="PASSED"');
    expect(html).toContain('Aprobado');
    expect(html).toContain('value="UNDER_REVIEW"');
    expect(html).toContain('En evaluación');
  });

  it('translates displayed session statuses but preserves the underlying status for actions', async () => {
    vi.mocked(prisma.roleplaySession.count).mockResolvedValue(1);
    vi.mocked(prisma.roleplaySession.groupBy).mockResolvedValue([
      { status: 'PASSED', _count: { _all: 1 } },
    ] as never);
    vi.mocked(prisma.roleplaySession.findMany).mockResolvedValue([
      {
        id: 'roleplay-test-001', status: 'PASSED',
        createdAt: new Date('2026-11-20T12:00:00.000Z'),
        interpreter: { id: 1, name: 'Intérprete de prueba', emailCorporativo: 'test@example.test' },
        recruitmentCandidate: null,
        qaScore: { id: 9, totalScore: 95, criticalError: false },
      },
    ] as never);

    const html = renderToStaticMarkup(await AdminRoleplaysPage({
      searchParams: Promise.resolve({ status: 'PASSED' }),
    }));

    expect(html).toContain('Intérprete de prueba');
    expect(html).toContain('Aprobado');
    expect(html).not.toContain('>PASSED<');
    expect(html).toContain('bg-[var(--theme-track)]');
    expect(html).toContain('max-width');
    expect(html).toContain('Ver evaluación');
    expect(prisma.roleplaySession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PASSED' }),
      }),
    );
  });
});
