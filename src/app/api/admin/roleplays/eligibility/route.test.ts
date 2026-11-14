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
        where: expect.objectContaining({
          interpreterId: { in: [10, 11, 12] },
          recruitmentCandidateId: null,
          status: { in: expect.arrayContaining(['DRAFT', 'INVITED', 'PASSED']) },
        }),
        select: { interpreterId: true },
      }),
    );
  });

  it('does not count candidate recruitment history as an interpreter blocking attempt', async () => {
    // Database returns only interpreter-owned records when recruitmentCandidateId is null.
    vi.mocked(prisma.roleplaySession.findMany).mockResolvedValue([] as never);
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      activeCount: 3, eligibleCount: 3, skippedCount: 0,
    });
    expect(prisma.roleplaySession.findMany).toHaveBeenCalledWith({
      where: {
        interpreterId: { in: [10, 11, 12] },
        recruitmentCandidateId: null,
        status: { in: expect.arrayContaining(['DRAFT', 'INVITED', 'PASSED']) },
      },
      select: { interpreterId: true },
    });
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

  it('redacts private database diagnostics from eligibility errors and logs', async () => {
    const error = new Error('connection-string:PRIVATE_DATABASE_SECRET');
    error.name = 'PRIVATE_PROVIDER_TOKEN';
    vi.mocked(prisma.interpreter.findMany).mockRejectedValueOnce(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await GET();
      const body = await response.json();
      expect(response.status).toBe(500);
      expect(JSON.stringify(body)).not.toContain('PRIVATE_DATABASE_SECRET');
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_DATABASE_SECRET');
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_PROVIDER_TOKEN');
      expect(log).toHaveBeenCalledWith('Get Roleplay Eligibility Error:', 'Error');
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(response.headers.get('Vary')).toBe('Cookie');
    } finally {
      log.mockRestore();
    }
  });
});
