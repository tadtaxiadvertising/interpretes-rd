// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  validate: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('@/lib/auth/actions', () => ({ validateAction: m.validate }));
vi.mock('@/lib/prisma', () => ({
  default: { roleplaySession: { findMany: m.findMany } },
}));

import { GET } from '../route';

describe('GET /api/dashboard/roleplays — interpreter ownership and minimal exposure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.validate.mockResolvedValue({ profile: { interpreterId: 42 } });
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
    const result = await GET();
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
    const result = await GET();
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
    expect(result.headers.get('Vary')).toBe('Cookie');
  });

  it('rejects a candidate/admin-inappropriate role before querying session data', async () => {
    m.validate.mockResolvedValueOnce({ error: 'Forbidden' });

    const result = await GET();
    expect(result.status).toBe(403);
    expect(m.findMany).not.toHaveBeenCalled();
  });

  it('requires an interpreter profile', async () => {
    m.validate.mockResolvedValueOnce({ profile: { interpreterId: null } });

    const result = await GET();
    expect(result.status).toBe(404);
    expect(m.findMany).not.toHaveBeenCalled();
  });
});
