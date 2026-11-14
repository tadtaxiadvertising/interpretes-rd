import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  identity: null as any,
  accessFindUnique: vi.fn(),
  accessUpdate: vi.fn(),
  sessionUpdateMany: vi.fn(),
  sessionFindUnique: vi.fn(),
  setCookie: vi.fn(),
  applyRateLimit: vi.fn(),
}));

vi.mock('@/lib/identity/resolve-user', () => ({
  resolveCurrentIdentity: async () => m.identity,
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    roleplayAccess: {
      findUnique: m.accessFindUnique,
      update: m.accessUpdate,
    },
    roleplaySession: {
      updateMany: m.sessionUpdateMany,
      findUnique: m.sessionFindUnique,
    },
  },
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ set: m.setCookie }),
}));
vi.mock('@/lib/security/rate-limit', () => ({
  applyRateLimit: m.applyRateLimit,
  createRateLimitHeaders: vi.fn(() => ({})),
  RATE_LIMITS: { inviteValidation: { maxRequests: 5, windowMs: 60_000, keyPrefix: 'invite' } },
}));

import { POST } from '@/app/api/roleplay/start/route';

function makeRequest(token = 'secret-token') {
  return new NextRequest('http://localhost/api/roleplay/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

describe('POST /api/roleplay/start race protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.identity = { role: 'candidate', candidateId: 5, interpreterId: null };
    m.applyRateLimit.mockReturnValue({ success: true });
    m.accessFindUnique.mockResolvedValue({
      id: 'access-1',
      sessionId: 'session-1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      session: {
        id: 'session-1',
        status: 'DRAFT',
        baseAudioUrl: 'https://example.test/base.webm', recruitmentCandidateId: 5, interpreterId: null,
      },
    });
    m.accessUpdate.mockResolvedValue({ id: 'access-1' });
    m.sessionUpdateMany.mockResolvedValue({ count: 1 });
    m.sessionFindUnique.mockResolvedValue({ status: 'STARTED' });
  });

  it('requires authentication before looking up a bearer invitation', async () => {
    m.identity = null;
    const response = await POST(makeRequest());
    expect(response.status).toBe(401);
    expect(m.accessFindUnique).not.toHaveBeenCalled();
    expect(m.sessionUpdateMany).not.toHaveBeenCalled();
    expect(m.setCookie).not.toHaveBeenCalled();
  });

  it('rejects a different candidate even if they possess a valid invitation', async () => {
    m.identity = { role: 'candidate', candidateId: 99, interpreterId: null };
    const response = await POST(makeRequest());
    expect(response.status).toBe(403);
    expect(m.sessionUpdateMany).not.toHaveBeenCalled();
    expect(m.accessUpdate).not.toHaveBeenCalled();
    expect(m.setCookie).not.toHaveBeenCalled();
  });

  it('rejects an interpreter trying to start a legacy dual-linked candidate session', async () => {
    m.identity = { role: 'interpreter', candidateId: null, interpreterId: 7 };
    m.accessFindUnique.mockResolvedValueOnce({
      id: 'access-1',
      sessionId: 'session-1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      session: { id: 'session-1', status: 'DRAFT', baseAudioUrl: 'https://example.test/base.webm', recruitmentCandidateId: 5, interpreterId: 7 },
    });
    const response = await POST(makeRequest());
    expect(response.status).toBe(403);
    expect(m.sessionUpdateMany).not.toHaveBeenCalled();
    expect(m.setCookie).not.toHaveBeenCalled();
  });

  it('uses compare-and-set before marking the invitation started', async () => {
    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(m.sessionUpdateMany).toHaveBeenCalledWith({
      where: { id: 'session-1', status: 'DRAFT' },
      data: { status: 'STARTED' },
    });
    expect(m.accessUpdate).toHaveBeenCalledWith({
      where: { id: 'access-1' },
      data: { startedAt: expect.any(Date), validatedAt: expect.any(Date) },
    });
    const accessData = m.accessUpdate.mock.calls[0][0].data;
    expect(accessData.startedAt.getTime()).toBe(accessData.validatedAt.getTime());
    expect(accessData).not.toHaveProperty('usedAt');
    expect(m.setCookie).toHaveBeenCalledWith('roleplay_session', 'session-1', expect.any(Object));
  });

  it('rejects a terminal transition race without issuing a cookie', async () => {
    m.sessionUpdateMany.mockResolvedValue({ count: 0 });
    m.sessionFindUnique.mockResolvedValue({ status: 'EVALUATED' });

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.success).toBe(false);
    expect(m.accessUpdate).not.toHaveBeenCalled();
    expect(m.setCookie).not.toHaveBeenCalled();
  });

  it('resumes when a concurrent request already started the session', async () => {
    m.sessionUpdateMany.mockResolvedValue({ count: 0 });
    m.sessionFindUnique.mockResolvedValue({ status: 'STARTED' });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(m.accessUpdate).toHaveBeenCalledWith({
      where: { id: 'access-1' },
      data: { startedAt: expect.any(Date), validatedAt: expect.any(Date) },
    });
    expect(m.setCookie).toHaveBeenCalledWith('roleplay_session', 'session-1', expect.any(Object));
  });
  it('never reflects internal errors to token holders', async () => {
    const secret = 'postgresql://username:password@internal.invalid/roleplays';
    m.accessFindUnique.mockRejectedValueOnce(new Error(secret));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await POST(makeRequest('secret-token'));
      const body = await response.json();
      expect(response.status).toBe(500);
      expect(JSON.stringify(body)).not.toContain(secret);
      expect(JSON.stringify(body)).not.toContain('secret-token');
      expect(JSON.stringify(log.mock.calls)).not.toContain('username');
      expect(JSON.stringify(log.mock.calls)).not.toContain('password');
      expect(JSON.stringify(log.mock.calls)).not.toContain('internal.invalid');
      expect(body.error).toContain('No fue posible iniciar el roleplay');
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(m.setCookie).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('never logs injected exception names containing secret token material', async () => {
    const injected = new Error('Database failure');
    injected.name = 'Bearer-private-invite-secret';
    m.accessFindUnique.mockRejectedValueOnce(injected);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await POST(makeRequest());
      expect(response.status).toBe(500);
      expect(JSON.stringify(log.mock.calls)).not.toContain('Bearer-private-invite-secret');
      expect(log).toHaveBeenCalledWith('Start Roleplay Error:', 'Error');
      expect(m.setCookie).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('never caches a successful start response containing the audio URL', async () => {
    const response = await POST(makeRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Vary')).toBe('Cookie');
  });

  it('rate-limits legacy token starts before a database lookup', async () => {
    m.applyRateLimit.mockReturnValueOnce({ success: false });
    const response = await POST(makeRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(m.accessFindUnique).not.toHaveBeenCalled();
    expect(m.setCookie).not.toHaveBeenCalled();
  });

  it('rejects unexpectedly long tokens before querying invitation records', async () => {
    const response = await POST(makeRequest('x'.repeat(513)));
    expect(response.status).toBe(400);
    expect(m.accessFindUnique).not.toHaveBeenCalled();
    expect(m.setCookie).not.toHaveBeenCalled();
  });

});
