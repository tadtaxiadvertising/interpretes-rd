import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  accessFindUnique: vi.fn(),
  accessUpdate: vi.fn(),
  sessionUpdateMany: vi.fn(),
  sessionFindUnique: vi.fn(),
  setCookie: vi.fn(),
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
    m.accessFindUnique.mockResolvedValue({
      id: 'access-1',
      sessionId: 'session-1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      session: {
        id: 'session-1',
        status: 'DRAFT',
        baseAudioUrl: 'https://example.test/base.webm',
      },
    });
    m.accessUpdate.mockResolvedValue({ id: 'access-1' });
    m.sessionUpdateMany.mockResolvedValue({ count: 1 });
    m.sessionFindUnique.mockResolvedValue({ status: 'STARTED' });
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
    expect(m.accessUpdate).toHaveBeenCalled();
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
    expect(m.accessUpdate).toHaveBeenCalled();
    expect(m.setCookie).toHaveBeenCalledWith('roleplay_session', 'session-1', expect.any(Object));
  });
});
