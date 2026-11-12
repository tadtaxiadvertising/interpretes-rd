// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/actions', () => ({ validateAction: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: { findMany: vi.fn() },
    roleplaySession: { findMany: vi.fn() },
  },
}));

import { GET } from './route';
import { validateAction } from '@/lib/auth/actions';
import prisma from '@/lib/prisma';

describe('GET /api/admin/roleplays/eligibility', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(validateAction).mockResolvedValue({ user: {}, profile: {} } as never);
    vi.mocked(prisma.interpreter.findMany).mockResolvedValue([{ id: 10 }, { id: 11 }, { id: 12 }] as never);
    vi.mocked(prisma.roleplaySession.findMany).mockResolvedValue([{ interpreterId: 10 }, { interpreterId: 10 }, { interpreterId: 12 }] as never);
  });

  it('requires admin access before reading any roleplay data', async () => {
    vi.mocked(validateAction).mockResolvedValue({ error: 'Forbidden' } as never);
    const response = await GET();
    expect(response.status).toBe(403);
    expect(prisma.interpreter.findMany).not.toHaveBeenCalled();
    expect(prisma.roleplaySession.findMany).not.toHaveBeenCalled();
  });

  it('counts each blocked active interpreter only once', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      success: true,
      data: { activeCount: 3, eligibleCount: 1, skippedCount: 2 },
    });
    expect(prisma.interpreter.findMany).toHaveBeenCalledWith({
      where: { status: 'Activo' }, select: { id: true }, orderBy: { id: 'asc' },
    });
    expect(prisma.roleplaySession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ interpreterId: { in: [10, 11, 12] } }),
        select: { interpreterId: true },
      }),
    );
  });

  it('returns zero counts without querying sessions when nobody is active', async () => {
    vi.mocked(prisma.interpreter.findMany).mockResolvedValue([] as never);
    const response = await GET();
    expect(await response.json()).toEqual({
      success: true,
      data: { activeCount: 0, eligibleCount: 0, skippedCount: 0 },
    });
    expect(prisma.roleplaySession.findMany).not.toHaveBeenCalled();
  });

  it('returns generic error details without exposing internal DB errors', async () => {
    vi.mocked(prisma.interpreter.findMany).mockRejectedValue(new Error('connection-string:secret'));
    const response = await GET();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('connection-string:secret');
  });
});
