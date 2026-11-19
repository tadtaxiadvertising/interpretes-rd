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

function expectPrivate(res: Response) {
  expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  for (const field of ['Authorization', 'Cookie', 'Origin']) {
    expect(res.headers.get('Vary')).toContain(field);
  }
}

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
    expectPrivate(res);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns the roster for an authorized admin', async () => {
    guardApiAuth.mockResolvedValue(null);
    findMany.mockResolvedValue([{ id: 1, name: 'Ana' }]);

    const res = await GET(new Request('http://localhost/api/presence/roster'));

    expect(res.status).toBe(200);
    expectPrivate(res);
    expect(findMany).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toEqual({ interpreters: [{ id: 1, name: 'Ana' }] });
  });

  it('does not log raw database errors or cache a failed roster response', async () => {
    guardApiAuth.mockResolvedValue(null);
    const secret = new Error('postgresql://operator:PRIVATE_PASSWORD@db.internal/production');
    secret.name = 'Bearer PRIVATE_ADMIN_TOKEN';
    findMany.mockRejectedValueOnce(secret);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await GET(new Request('http://localhost/api/presence/roster'));
      expect(res.status).toBe(500);
      expectPrivate(res);
      expect(await res.json()).toEqual({ error: 'Failed to fetch roster' });
      expect(log).toHaveBeenCalledWith('[presence/roster] Error:', 'Error');
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE_|postgresql:|db\.internal/);
    } finally {
      log.mockRestore();
    }
  });
});
