import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  identity: null as any,
  session: null as any,
  findUnique: vi.fn(),
}));

vi.mock('@/lib/identity/resolve-user', () => ({
  resolveCurrentIdentity: async () => m.identity,
}));

vi.mock('@/lib/prisma', () => ({
  default: { roleplaySession: { findUnique: m.findUnique } },
}));

vi.mock('@/lib/security/rate-limit', () => ({
  applyRateLimit: () => ({ success: true }),
  createRateLimitHeaders: () => ({}),
  RATE_LIMITS: { sessionAccess: {} },
}));

import { GET } from '@/app/api/roleplay/session/[id]/route';

function makeRequest(cookieSessionId?: string) {
  return new NextRequest('http://localhost/api/roleplay/session/sess-1', {
    method: 'GET',
    headers: cookieSessionId ? { cookie: `roleplay_session=${cookieSessionId}` } : {},
  });
}

const params = Promise.resolve({ id: 'sess-1' });

function candidateSession(status: string) {
  return {
    id: 'sess-1',
    status,
    interpreterId: null,
    recruitmentCandidateId: 5,
    baseAudioUrl: 'https://x/a.webm',
    recordedAudioUrl: null,
    currentScenarioIndex: 0,
    access: { tokenHash: 'h', usedAt: null, validatedAt: new Date() },
    scenarios: [],
  };
}

describe('GET /api/roleplay/session/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.identity = { role: 'interpreter', interpreterId: null };
    m.session = candidateSession('STARTED');
    m.findUnique.mockImplementation(async () => m.session);
  });

  it('rejects a candidate without the bound session cookie', async () => {
    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.success).toBe(false);
  });

  it('rejects a cookie bound to a different session', async () => {
    const res = await GET(makeRequest('sess-other'), { params });

    expect(res.status).toBe(403);
  });

  it('allows the bound candidate to read an active attempt', async () => {
    const res = await GET(makeRequest('sess-1'), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.id).toBe('sess-1');
  });

  it('lets the bound candidate reload a submitted attempt (read-only)', async () => {
    m.session = candidateSession('SUBMITTED');

    const res = await GET(makeRequest('sess-1'), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.status).toBe('SUBMITTED');
  });

  it('rejects an interpreter who does not own the session', async () => {
    m.session = { ...candidateSession('STARTED'), recruitmentCandidateId: null, interpreterId: 7 };
    m.identity = { role: 'interpreter', interpreterId: 999 };

    const res = await GET(makeRequest(), { params });

    expect(res.status).toBe(403);
  });
});
