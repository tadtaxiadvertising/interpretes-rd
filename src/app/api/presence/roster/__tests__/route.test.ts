import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const guardApiAuth = vi.fn();
vi.mock('@/lib/api-auth', () => ({
  guardApiAuth: (req: Request, role?: string) => guardApiAuth(req, role),
}));

const findMany = vi.fn();
vi.mock('@/lib/prisma', () => ({
  default: { interpreter: { findMany: (...args: unknown[]) => findMany(...args) } },
}));

import { GET } from '@/app/api/presence/roster/route';

describe('GET /api/presence/roster', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires the admin role and never queries the database when denied', async () => {
    guardApiAuth.mockResolvedValue(
      NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    );

    const res = await GET(new Request('http://localhost/api/presence/roster'));

    expect(guardApiAuth).toHaveBeenCalledWith(expect.anything(), 'admin');
    expect(res.status).toBe(403);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns the roster for an authorized admin', async () => {
    guardApiAuth.mockResolvedValue(null);
    findMany.mockResolvedValue([{ id: 1, name: 'Ana' }]);

    const res = await GET(new Request('http://localhost/api/presence/roster'));

    expect(res.status).toBe(200);
    expect(findMany).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toEqual({ interpreters: [{ id: 1, name: 'Ana' }] });
  });
});
