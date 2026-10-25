import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  identity: null as any,
  session: null as any,
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  accessUpdateMany: vi.fn(),
  applicationFindUnique: vi.fn(),
}));

vi.mock('@/lib/identity/resolve-user', () => ({
  resolveCurrentIdentity: async () => m.identity,
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    roleplaySession: { findUnique: m.findUnique, updateMany: m.updateMany },
    roleplayAccess: { updateMany: m.accessUpdateMany },
    recruitmentApplication: { findUnique: m.applicationFindUnique },
  },
}));

vi.mock('@/lib/security/rate-limit', () => ({
  applyRateLimit: () => ({ success: true }),
  createRateLimitHeaders: () => ({}),
  RATE_LIMITS: { sessionAccess: {} },
}));

import { POST } from '@/app/api/roleplay/session/[id]/start/route';

function makeRequest(cookieSessionId?: string) {
  return new NextRequest('http://localhost/api/roleplay/session/sess-1/start', {
    method: 'POST',
    headers: cookieSessionId ? { cookie: `roleplay_session=${cookieSessionId}` } : {},
  });
}

const params = Promise.resolve({ id: 'sess-1' });

const CANDIDATE_SESSION = {
  id: 'sess-1',
  status: 'DRAFT',
  interpreterId: null,
  recruitmentCandidateId: 5,
};

const INTERPRETER_SESSION = {
  id: 'sess-1',
  status: 'INVITED',
  interpreterId: 7,
  recruitmentCandidateId: null,
};

describe('POST /api/roleplay/session/[id]/start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.identity = { role: 'interpreter', interpreterId: 7 };
    m.session = INTERPRETER_SESSION;
    m.findUnique.mockImplementation(async () => m.session);
    m.updateMany.mockResolvedValue({ count: 1 });
    m.accessUpdateMany.mockResolvedValue({ count: 1 });
    m.applicationFindUnique.mockResolvedValue(null);
  });

  it('rejects unauthenticated callers before touching the database', async () => {
    m.identity = null;

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(401);
    expect(m.findUnique).not.toHaveBeenCalled();
  });

  it('rejects roleplay start before onboarding is complete', async () => {
    m.identity = {
      role: 'interpreter',
      interpreterId: 7,
      eligibility: { needsOnboarding: true },
    };

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(403);
    expect(m.findUnique).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.accessUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects a candidate session when the session cookie is missing', async () => {
    m.session = CANDIDATE_SESSION;
    m.identity = { role: 'interpreter', interpreterId: null };

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(403);
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a candidate session when the cookie points at another session', async () => {
    m.session = CANDIDATE_SESSION;
    m.identity = { role: 'interpreter', interpreterId: null };

    const res = await POST(makeRequest('sess-other'), { params });

    expect(res.status).toBe(403);
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an interpreter session for a different interpreter', async () => {
    m.session = INTERPRETER_SESSION;
    m.identity = { role: 'interpreter', interpreterId: 999 };

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(403);
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a stale candidate session cookie when the application is no longer eligible', async () => {
    m.session = CANDIDATE_SESSION;
    m.identity = {
      role: 'interpreter',
      interpreterId: null,
      eligibility: { needsOnboarding: false },
    };
    m.applicationFindUnique.mockResolvedValue({ status: 'REJECTED' });

    const res = await POST(makeRequest('sess-1'), { params });

    expect(res.status).toBe(409);
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.accessUpdateMany).not.toHaveBeenCalled();
  });

  it('transitions a pre-start session to STARTED for its owner', async () => {
    const res = await POST(makeRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('STARTED');
    expect(body.data.resumed).toBe(false);
    expect(m.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sess-1', status: 'INVITED' },
        data: { status: 'STARTED' },
      })
    );
    expect(m.accessUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('is idempotent for a session already in progress', async () => {
    m.session = { ...INTERPRETER_SESSION, status: 'STARTED' };

    const res = await POST(makeRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.resumed).toBe(true);
    expect(m.updateMany).not.toHaveBeenCalled();
  });


  it('does not overwrite a submitted state when it changes after the initial read', async () => {
    m.findUnique
      .mockResolvedValueOnce(INTERPRETER_SESSION)
      .mockResolvedValueOnce({ id: 'sess-1', status: 'SUBMITTED' });
    m.updateMany.mockResolvedValue({ count: 0 });

    const res = await POST(makeRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.success).toBe(false);
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { id: 'sess-1', status: 'INVITED' },
      data: { status: 'STARTED' },
    });
    expect(m.accessUpdateMany).not.toHaveBeenCalled();
  });

  it('refuses to restart a submitted session', async () => {
    m.session = { ...INTERPRETER_SESSION, status: 'SUBMITTED' };

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(409);
    expect(m.updateMany).not.toHaveBeenCalled();
  });
});
