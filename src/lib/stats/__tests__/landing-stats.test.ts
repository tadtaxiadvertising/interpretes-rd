import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  count: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: { count: m.count },
    productionLog: { findMany: m.findMany },
  },
}));

import { getLandingStats } from '@/lib/stats/landing-stats';

describe('getLandingStats', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns real interpreter and 5-year account counts', async () => {
    m.count.mockResolvedValue(128);
    m.findMany.mockResolvedValue([{ accountId: 1 }, { accountId: 2 }, { accountId: 3 }]);

    const stats = await getLandingStats();

    expect(stats).toEqual({ interpreters: 128, accountsWorked: 3 });
    expect(m.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        distinct: ['accountId'],
        where: expect.objectContaining({
          accountId: { not: null },
          date: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      })
    );
  });

  it('never fabricates a value when the data cannot be read', async () => {
    m.count.mockRejectedValue(new Error('db down'));

    const stats = await getLandingStats();

    expect(stats).toBeNull();
  });
});
