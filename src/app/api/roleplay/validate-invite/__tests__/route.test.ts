import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  access: null as any,
  accessFindUnique: vi.fn(),
  accessUpdate: vi.fn(),
  accessUpdateMany: vi.fn(),
  sessionUpdateMany: vi.fn(),
  sessionFindUnique: vi.fn(),
  setCookie: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    roleplayAccess: {
      findUnique: m.accessFindUnique,
      update: m.accessUpdate,
      updateMany: m.accessUpdateMany,
    },
    roleplaySession: {
      updateMany: m.sessionUpdateMany,
      findUnique: m.sessionFindUnique,
    },
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

import { POST } from '@/app/api/roleplay/validate-invite/route';

function makeRequest(token = 'secret-token') {
  return new NextRequest('http://localhost/api/roleplay/validate-invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

describe('POST /api/roleplay/validate-invite race protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.access = {
      id: 'access-1',
      sessionId: 'session-1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      session: { id: 'session-1', status: 'DRAFT', baseAudioUrl: 'https://example.test/base.webm' },
    };
    m.accessFindUnique.mockImplementation(async () => m.access);
    m.accessUpdate.mockResolvedValue({ id: 'access-1' });
    m.accessUpdateMany.mockResolvedValue({ count: 1 });
    m.sessionUpdateMany.mockResolvedValue({ count: 1 });
    m.sessionFindUnique.mockResolvedValue({ status: 'STARTED' });
  });

  it('starts only if the session still has the state observed during lookup', async () => {
    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(m.sessionUpdateMany).toHaveBeenCalledWith({
      where: { id: 'session-1', status: 'DRAFT' },
      data: { status: 'STARTED' },
    });
    expect(m.setCookie).toHaveBeenCalledWith('session-1');
  });

  it('rejects when the session became terminal after invitation lookup', async () => {
    m.sessionUpdateMany.mockResolvedValue({ count: 0 });
    m.sessionFindUnique.mockResolvedValue({ status: 'EVALUATED' });

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.success).toBe(false);
    expect(m.setCookie).not.toHaveBeenCalled();
    expect(m.accessUpdate).not.toHaveBeenCalled();
  });

  it('resumes if a concurrent request already transitioned the session to STARTED', async () => {
    m.sessionUpdateMany.mockResolvedValue({ count: 0 });
    m.sessionFindUnique.mockResolvedValue({ status: 'STARTED' });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(m.setCookie).toHaveBeenCalledWith('session-1');
  });
});
