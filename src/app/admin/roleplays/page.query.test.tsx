// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: {
    roleplaySession: {
      count: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));
vi.mock('@/components/admin/SessionActions', () => ({
  SessionActions: () => null,
}));

import prisma from '@/lib/prisma';
import AdminRoleplaysPage from './page';

describe('Admin roleplay list query uses the displayed page and proper ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.roleplaySession.count).mockResolvedValue(35);
    vi.mocked(prisma.roleplaySession.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.roleplaySession.findMany).mockResolvedValue([]);
  });

  it('fetches the final valid page rather than an empty offset for stale URLs', async () => {
    await AdminRoleplaysPage({
      searchParams: Promise.resolve({
        participantType: 'interpreter', status: 'SUBMITTED', page: '999',
      }),
    });
    expect(prisma.roleplaySession.count).toHaveBeenCalledWith({
      where: {
        interpreterId: { not: null },
        recruitmentCandidateId: null,
        status: 'SUBMITTED',
      },
    });
    expect(prisma.roleplaySession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 20,
        take: 20,
        where: expect.objectContaining({
          interpreterId: { not: null }, recruitmentCandidateId: null,
        }),
      }),
    );
  });

  it('avoids offset underflow with zero matches and protects candidate filters', async () => {
    vi.mocked(prisma.roleplaySession.count).mockResolvedValue(0);
    await AdminRoleplaysPage({
      searchParams: Promise.resolve({ participantType: 'candidate', page: '88' }),
    });
    expect(prisma.roleplaySession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        where: { recruitmentCandidateId: { not: null } },
      }),
    );
  });
});
