// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const m = vi.hoisted(() => ({
  guard: vi.fn(),
  leaderboard: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ guardApiAuth: m.guard }));
vi.mock('@/lib/ranking/calculate', () => ({ getAdminLeaderboard: m.leaderboard }));

import { GET } from './route';

const request = (authorization?: string) => new Request('http://localhost/api/admin/ranking', {
  method: 'GET',
  headers: authorization ? { Authorization: authorization } : {},
});

describe('admin ranking identity and response privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.guard.mockResolvedValue(null);
    m.leaderboard.mockResolvedValue([
      { interpreterId: 7, name: 'Test Interpreter', qaScore: 96, productionMinutes: 120 },
    ]);
  });

  it('uses the API authorization guard before reading any interpreter rankings', async () => {
    const denial = NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    m.guard.mockResolvedValueOnce(denial);

    const res = await GET(request('Bearer interpreter-token'));
    expect(res.status).toBe(403);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toContain('Authorization');
    expect(m.guard).toHaveBeenCalledWith(expect.any(Request), 'admin');
    expect(m.leaderboard).not.toHaveBeenCalled();
  });

  it('returns only private, uncacheable admin data after authorization', async () => {
    const res = await GET(request('Bearer verified-admin'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data[0]).toMatchObject({ interpreterId: 7, name: 'Test Interpreter' });
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toContain('Cookie');
    expect(res.headers.get('Vary')).toContain('Authorization');
    expect(m.guard).toHaveBeenCalledWith(expect.any(Request), 'admin');
  });

  it('does not leak or log provider errors that include database credentials', async () => {
    m.leaderboard.mockRejectedValueOnce(
      new Error('postgresql://db-user:PRIVATE_SECRET@internal-db.invalid/production'),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await GET(request());
      const body = await res.json();
      expect(res.status).toBe(500);
      expect(body).toEqual({ success: false, error: 'No fue posible calcular el ranking administrativo.' });
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(res.headers.get('Vary')).toContain('Authorization');
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_SECRET');
      expect(JSON.stringify(log.mock.calls)).not.toContain('internal-db.invalid');
    } finally {
      log.mockRestore();
    }
  });

  it('supports the cookie-only admin flow by delegating identity resolution to the API guard', async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(m.guard).toHaveBeenCalledOnce();
    expect(m.leaderboard).toHaveBeenCalledOnce();
  });
});
