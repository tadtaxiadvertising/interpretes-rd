// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  validate: vi.fn(),
  findMany: vi.fn(),
  actorFromBearer: vi.fn(),
}));

vi.mock('@/lib/auth/actions', () => ({ validateAction: m.validate }));
vi.mock('@/lib/api-auth', () => ({ actorFromBearer: m.actorFromBearer }));
vi.mock('@/lib/prisma', () => ({
  default: { roleplaySession: { findMany: m.findMany } },
}));

import { GET } from '../route';

function request(authorization?: string): Request {
  return new Request('https://interpretes.example/api/dashboard/roleplays', {
    headers: authorization === undefined ? {} : { Authorization: authorization },
  });
}

describe('GET /api/dashboard/roleplays — interpreter ownership and minimal exposure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.validate.mockResolvedValue({
      user: { userId: 'cookie-interpreter-42' },
      profile: { interpreterId: 42 },
    });
    m.findMany.mockResolvedValue([
      {
        id: 'own-session',
        status: 'SUBMITTED',
        createdAt: new Date('2026-11-01T12:00:00.000Z'),
        submittedAt: new Date('2026-11-02T12:00:00.000Z'),
        evaluatedAt: null,
        qaScore: { totalScore: 85, criticalError: false, accionRequerida: null },
        // Simulate an accidentally expanded Prisma result. Private fields
        // must never be serialized to the interpreter's list response.
        baseAudioUrl: 'https://private-storage.example/token',
        baseAudioPath: 'private/roleplay.mp3',
        recruitmentCandidateId: 7,
        evaluatorId: 'PRIVATE-EVALUATOR',
      },
    ]);
  });

  it('only queries interpreter-owned sessions that are not recruitment candidate sessions', async () => {
    const result = await GET(request());
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(m.validate).toHaveBeenCalledWith('interpreter');
    expect(m.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { interpreterId: 42, recruitmentCandidateId: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        createdAt: true,
        submittedAt: true,
        evaluatedAt: true,
        qaScore: { select: { totalScore: true, criticalError: true, accionRequerida: true } },
      },
    }));
    expect(body.data[0].id).toBe('own-session');
  });

  it('returns only list metadata and never serializes audio secrets or candidate ownership', async () => {
    const result = await GET(request());
    const body = await result.json();

    expect(body.data[0]).toEqual({
      id: 'own-session',
      status: 'SUBMITTED',
      createdAt: '2026-11-01T12:00:00.000Z',
      submittedAt: '2026-11-02T12:00:00.000Z',
      evaluatedAt: null,
      qaScore: { totalScore: 85, criticalError: false, accionRequerida: null },
    });
    expect(JSON.stringify(body)).not.toContain('PRIVATE-EVALUATOR');
    expect(JSON.stringify(body)).not.toContain('private-storage');
    expect(JSON.stringify(body)).not.toContain('recruitmentCandidateId');
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(result.headers.get('Vary')).toBe('Cookie, Authorization');
  });

  it('rejects a candidate/admin-inappropriate role before querying session data', async () => {
    m.validate.mockResolvedValueOnce({ error: 'Forbidden' });

    const result = await GET(request());
    expect(result.status).toBe(403);
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(result.headers.get('Vary')).toBe('Cookie, Authorization');
    expect(m.findMany).not.toHaveBeenCalled();
  });

  it('does not expose database diagnostics in the response or error log', async () => {
    const error = new Error('postgresql://private:PRIVATE_DB_PASSWORD@internal.invalid');
    error.name = 'Bearer PRIVATE_AUDIO_TOKEN';
    m.findMany.mockRejectedValueOnce(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await GET(request());
      const body = await result.json();
      expect(result.status).toBe(500);
      expect(JSON.stringify(body)).not.toContain('PRIVATE_DB_PASSWORD');
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE_|postgresql:/);
      expect(log).toHaveBeenCalledWith('Get My Roleplays Error:', 'Error');
      expect(result.headers.get('Cache-Control')).toBe('private, no-store');
      expect(result.headers.get('Vary')).toBe('Cookie, Authorization');
    } finally {
      log.mockRestore();
    }
  });

  it('allows a cookie-only interpreter without resolving an explicit bearer', async () => {
    const result = await GET(request());
    expect(result.status).toBe(200);
    expect(m.actorFromBearer).not.toHaveBeenCalled();
  });

  it('accepts a matching interpreter bearer and cookie', async () => {
    m.actorFromBearer.mockResolvedValueOnce({
      userId: 'cookie-interpreter-42', role: 'interpreter', interpreterId: 42,
    });
    const result = await GET(request('Bearer matching-token'));
    expect(result.status).toBe(200);
    expect(m.actorFromBearer).toHaveBeenCalledOnce();
    expect(m.findMany).toHaveBeenCalledOnce();
  });

  it('rejects a bearer from another interpreter before any data read', async () => {
    m.actorFromBearer.mockResolvedValueOnce({
      userId: 'different-interpreter', role: 'interpreter', interpreterId: 99,
    });
    const result = await GET(request('Bearer different-token'));
    expect(result.status).toBe(403);
    expect(m.findMany).not.toHaveBeenCalled();
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(result.headers.get('Vary')).toContain('Authorization');
  });

  it('rejects matching userId with a different interpreter assignment', async () => {
    m.actorFromBearer.mockResolvedValueOnce({
      userId: 'cookie-interpreter-42', role: 'interpreter', interpreterId: 99,
    });
    const result = await GET(request('Bearer changed-assignment'));
    expect(result.status).toBe(403);
    expect(m.findMany).not.toHaveBeenCalled();
  });

  it('rejects admin/candidate bearer even when cookie is an interpreter', async () => {
    for (const role of ['admin', 'candidate']) {
      m.actorFromBearer.mockResolvedValueOnce({
        userId: 'cookie-interpreter-42', role, interpreterId: 42,
      });
      const result = await GET(request('Bearer wrong-role'));
      expect(result.status).toBe(403);
    }
    expect(m.findMany).not.toHaveBeenCalled();
  });

  it('rejects invalid and malformed authorization instead of falling back to cookie', async () => {
    for (const header of ['Basic invalid', 'Bearer expired-token']) {
      m.actorFromBearer.mockResolvedValueOnce(null);
      const result = await GET(request(header));
      expect(result.status).toBe(403);
    }
    expect(m.findMany).not.toHaveBeenCalled();
  });

  it('fails closed on bearer resolver failure before querying sessions', async () => {
    m.actorFromBearer.mockImplementationOnce(() => {
      throw new Error('Synthetic provider outage');
    });
    const result = await GET(request('Bearer unavailable'));
    expect(result.status).toBe(403);
    expect(m.findMany).not.toHaveBeenCalled();
  });

  it('does not accept bearer-only requests without an authorized cookie session', async () => {
    m.validate.mockResolvedValueOnce({ error: 'Not authenticated' });
    const result = await GET(request('Bearer valid-interpreter-token'));
    expect(result.status).toBe(403);
    expect(m.actorFromBearer).not.toHaveBeenCalled();
    expect(m.findMany).not.toHaveBeenCalled();
  });

  it('requires an interpreter profile', async () => {
    m.validate.mockResolvedValueOnce({ profile: { interpreterId: null } });

    const result = await GET(request());
    expect(result.status).toBe(404);
    expect(m.findMany).not.toHaveBeenCalled();
  });
});
