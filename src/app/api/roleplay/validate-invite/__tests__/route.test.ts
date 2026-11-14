import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  identity: null as any,
  access: null as any,
  accessFindUnique: vi.fn(),
  accessUpdate: vi.fn(),
  accessUpdateMany: vi.fn(),
  sessionUpdateMany: vi.fn(),
  sessionFindUnique: vi.fn(),
  setCookie: vi.fn(),
}));

vi.mock('@/lib/identity/resolve-user', () => ({
  resolveCurrentIdentity: async () => m.identity,
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
    m.identity = { role: 'candidate', candidateId: 5, interpreterId: null };
    m.access = {
      id: 'access-1',
      sessionId: 'session-1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      session: { id: 'session-1', status: 'DRAFT', baseAudioUrl: 'https://example.test/base.webm' , recruitmentCandidateId: 5, interpreterId: null},
    };
    m.accessFindUnique.mockImplementation(async () => m.access);
    m.accessUpdate.mockResolvedValue({ id: 'access-1' });
    m.accessUpdateMany.mockResolvedValue({ count: 1 });
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
    m.access = { ...m.access, session: { ...m.access.session, interpreterId: 7 } };
    const response = await POST(makeRequest());
    expect(response.status).toBe(403);
    expect(m.sessionUpdateMany).not.toHaveBeenCalled();
    expect(m.setCookie).not.toHaveBeenCalled();
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
  it('does not disclose invitation token, database details or audio URLs on internal failure', async () => {
    const secret = 'postgresql://hidden-user:secret@private.invalid/roleplay';
    m.accessFindUnique.mockRejectedValueOnce(new Error(secret));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await POST(makeRequest('secret-token'));
      const body = await response.json();
      expect(response.status).toBe(500);
      expect(JSON.stringify(body)).not.toContain(secret);
      expect(JSON.stringify(body)).not.toContain('secret-token');
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(JSON.stringify(log.mock.calls)).not.toContain('hidden-user');
      expect(JSON.stringify(log.mock.calls)).not.toContain('private.invalid');
      expect(m.setCookie).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('does not cache a successful invitation response containing session audio', async () => {
    const response = await POST(makeRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Vary')).toBe('Cookie');
  });

  it('rejects oversized invite tokens before accessing the database', async () => {
    const response = await POST(makeRequest('x'.repeat(513)));
    expect(response.status).toBe(400);
    expect(m.accessFindUnique).not.toHaveBeenCalled();
    expect(m.setCookie).not.toHaveBeenCalled();
  });

});
