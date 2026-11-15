// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  resolveApiActor: vi.fn(),
  getInterpreterMetrics: vi.fn(),
  getLeaderboard: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ resolveApiActor: m.resolveApiActor }));
vi.mock('@/services/metrics/metrics-service', () => ({
  getInterpreterMetrics: m.getInterpreterMetrics,
  getLeaderboard: m.getLeaderboard,
}));

import { GET } from './route';

const req = (authorization?: string) => new Request('http://localhost/api/dashboard/ranking', {
  headers: authorization ? { authorization } : {},
});
const own = {
  interpretedMinutes: 120, qaScore: 88, rankingPosition: 3, totalInterpreters: 15,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.resolveApiActor.mockResolvedValue({
    role: 'interpreter', userId: 'user-1', interpreterId: 7,
  });
  m.getInterpreterMetrics.mockResolvedValue(own);
  m.getLeaderboard.mockResolvedValue([{
    name: 'Test Interpreter', interpretedMinutes: 180,
    qaScore: 91, rankingPosition: 1, interpreterId: 8,
  }]);
});

describe('GET /api/dashboard/ranking privacy and identity', () => {
  it('requires an authenticated actor before querying metrics', async () => {
    m.resolveApiActor.mockResolvedValue(null);
    const res = await GET(req('Bearer expired-token'));
    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toContain('Authorization');
    expect(m.resolveApiActor).toHaveBeenCalledWith(expect.any(Request));
    expect(m.getInterpreterMetrics).not.toHaveBeenCalled();
    expect(m.getLeaderboard).not.toHaveBeenCalled();
  });

  it.each([
    ['administrator', { role: 'admin', interpreterId: 7, userId: 'admin-1' }],
    ['candidate', { role: 'candidate', interpreterId: null, userId: 'candidate-1' }],
    ['unlinked interpreter', { role: 'interpreter', interpreterId: null, userId: 'user-2' }],
  ])('refuses %s access without fetching production metrics', async (_label, actor) => {
    m.resolveApiActor.mockResolvedValue(actor);
    const res = await GET(req('Bearer role-token'));
    expect(res.status).toBe(403);
    expect(m.getInterpreterMetrics).not.toHaveBeenCalled();
    expect(m.getLeaderboard).not.toHaveBeenCalled();
  });

  it('returns only the authenticated interpreter metrics and existing public podium projection', async () => {
    const res = await GET(req('Bearer verified-interpreter-token'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toContain('Cookie');
    expect(res.headers.get('Vary')).toContain('Authorization');
    expect(m.getInterpreterMetrics).toHaveBeenCalledWith(7);
    const body = await res.json();
    expect(body.data.myMinutes).toBe(120);
    expect(body.data.leaderboard).toEqual([
      { position: 1, name: 'Test Interpreter', minutes: 180, qaScore: 91 },
    ]);
    expect(body.data.leaderboard[0]).not.toHaveProperty('interpreterId');
  });

  it('continues to support an interpreter authenticated with a browser cookie', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(m.getInterpreterMetrics).toHaveBeenCalledWith(7);
  });

  it('returns private 404 when monthly metrics are not available', async () => {
    m.getInterpreterMetrics.mockResolvedValueOnce(null);
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(m.getLeaderboard).not.toHaveBeenCalled();
  });

  it('never logs database exceptions containing secrets or exposes them to clients', async () => {
    m.getInterpreterMetrics.mockRejectedValueOnce(
      new Error('postgresql://private-user:PRIVATE_PASSWORD@db.invalid/production'),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await GET(req('Bearer verified-interpreter-token'));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ success: false, error: 'Internal server error' });
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE_PASSWORD|db\.invalid|postgresql:/);
    } finally {
      log.mockRestore();
    }
  });
});
