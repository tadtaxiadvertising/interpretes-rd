import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  access: null as any,
  findUnique: vi.fn(),
  accessUpdate: vi.fn(),
  accessUpdateMany: vi.fn(),
  sessionUpdateMany: vi.fn(),
  sessionFindUnique: vi.fn(),
  setCookie: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    roleplayAccess: {
      findUnique: m.findUnique,
      update: m.accessUpdate,
      updateMany: m.accessUpdateMany,
    },
    roleplaySession: { updateMany: m.sessionUpdateMany, findUnique: m.sessionFindUnique },
  },
}));

vi.mock('@/lib/roleplay/session-cookie', () => ({
  setRoleplaySessionCookie: (sessionId: string) => m.setCookie(sessionId),
}));

vi.mock('@/lib/security/rate-limit', () => ({
  applyRateLimit: () => ({ success: true }),
  createRateLimitHeaders: () => ({}),
  RATE_LIMITS: { inviteValidation: {} },
}));

import { POST } from '@/app/api/roleplay/validate-invite-by-code/route';

function makeRequest(inviteCode: string) {
  return new Request('http://localhost/api/roleplay/validate-invite-by-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inviteCode }),
  });
}

describe('POST /api/roleplay/validate-invite-by-code', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.access = {
      id: 'acc-1',
      sessionId: 'sess-1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      session: { id: 'sess-1', status: 'DRAFT', baseAudioUrl: 'https://x/a.webm' },
    };
    m.findUnique.mockImplementation(async () => m.access);
    m.accessUpdate.mockResolvedValue({ id: 'acc-1' });
    m.accessUpdateMany.mockResolvedValue({ count: 1 });
    m.sessionUpdateMany.mockResolvedValue({ count: 1 });
    m.sessionFindUnique.mockResolvedValue({ status: 'STARTED' });
  });

  it('rejects an unknown or expired invitation without binding a cookie', async () => {
    m.findUnique.mockResolvedValue(null);

    const res = await POST(makeRequest('NOPE0000'));

    expect(res.status).toBe(404);
    expect(m.setCookie).not.toHaveBeenCalled();
  });

  it('rejects a session that is no longer enterable', async () => {
    m.access = { ...m.access, session: { ...m.access.session, status: 'SUBMITTED' } };

    const res = await POST(makeRequest('ABCD1234'));

    expect(res.status).toBe(400);
    expect(m.setCookie).not.toHaveBeenCalled();
  });

  it('binds the cookie and starts a DRAFT session without consuming the invitation', async () => {
    const res = await POST(makeRequest('ABCD1234'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.sessionId).toBe('sess-1');
    expect(m.setCookie).toHaveBeenCalledWith('sess-1');
    expect(m.sessionUpdateMany).toHaveBeenCalledWith({
      where: { id: 'sess-1', status: 'DRAFT' },
      data: { status: 'STARTED' },
    });
    // Consumption is a later step: usedAt must not be written here.
    const updateCalls = [...m.accessUpdate.mock.calls, ...m.accessUpdateMany.mock.calls];
    for (const call of updateCalls) {
      expect(call[0].data.usedAt).toBeUndefined();
    }
  });

  it('resumes a STARTED session without re-transitioning it', async () => {
    m.access = { ...m.access, session: { ...m.access.session, status: 'STARTED' } };

    const res = await POST(makeRequest('ABCD1234'));

    expect(res.status).toBe(200);
    expect(m.setCookie).toHaveBeenCalledWith('sess-1');
    expect(m.sessionUpdateMany).not.toHaveBeenCalled();
  });
  it('does not overwrite a terminal state if it changes after invitation lookup', async () => {
    m.sessionUpdateMany.mockResolvedValue({ count: 0 });
    m.sessionFindUnique.mockResolvedValue({ status: 'SUBMITTED' });

    const res = await POST(makeRequest('ABCD1234'));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.success).toBe(false);
    expect(m.sessionUpdateMany).toHaveBeenCalledWith({
      where: { id: 'sess-1', status: 'DRAFT' },
      data: { status: 'STARTED' },
    });
    expect(m.setCookie).not.toHaveBeenCalled();
    expect(m.accessUpdate).not.toHaveBeenCalled();
  });

  it('resumes if a concurrent request already started the session', async () => {
    m.sessionUpdateMany.mockResolvedValue({ count: 0 });
    m.sessionFindUnique.mockResolvedValue({ status: 'STARTED' });

    const res = await POST(makeRequest('ABCD1234'));

    expect(res.status).toBe(200);
    expect(m.setCookie).toHaveBeenCalledWith('sess-1');
    expect(m.accessUpdate).toHaveBeenCalledWith({
      where: { id: 'acc-1' },
      data: { validatedAt: expect.any(Date) },
    });
  });

});
