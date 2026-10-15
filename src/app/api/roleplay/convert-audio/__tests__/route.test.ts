import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  identity: null as any,
  session: null as any,
  findUnique: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('@/lib/security/rate-limit', () => ({
  applyRateLimit: () => ({ success: true, limit: 10, remaining: 9, reset: Date.now() + 1000 }),
  createRateLimitHeaders: () => ({}),
  RATE_LIMITS: { audioUpload: {}, sessionAccess: {}, inviteValidation: {} },
}));

vi.mock('@/lib/identity/resolve-user', () => ({
  resolveCurrentIdentity: async () => m.identity,
}));

vi.mock('@/lib/prisma', () => ({
  default: { roleplaySession: { findUnique: (...args: any[]) => m.findUnique(...args) } },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: m.upload,
        createSignedUrl: () => ({ data: { signedUrl: 'https://signed/url' } }),
      }),
    },
  }),
}));

vi.mock('ffmpeg-static', () => ({ default: 'ffmpeg' }));
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, spawn: vi.fn() };
});

import { POST } from '@/app/api/roleplay/convert-audio/route';

const INTERPRETER_IDENTITY = { role: 'interpreter', interpreterId: null };

function makeRequest(cookie?: string): NextRequest {
  const fd = new FormData();
  fd.append('audio', new Blob(['abcd'], { type: 'text/plain' }), 'a.txt');
  fd.append('sessionId', 'sess-cand');
  fd.append('scenarioId', 'scenario_0');
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = `roleplay_session=${cookie}`;
  return new NextRequest('http://localhost/api/roleplay/convert-audio', {
    method: 'POST',
    body: fd,
    headers,
  });
}

const CANDIDATE_SESSION = {
  id: 'sess-cand',
  interpreterId: null,
  recruitmentCandidateId: 5,
  status: 'STARTED',
};

const INTERPRETER_SESSION = {
  id: 'sess-cand',
  interpreterId: 7,
  recruitmentCandidateId: null,
  status: 'STARTED',
};

describe('POST /api/roleplay/convert-audio candidate-access gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.findUnique.mockImplementation(async () => m.session);
    m.identity = INTERPRETER_IDENTITY;
    m.upload.mockResolvedValue({ error: null });
  });

  it('returns 401 when unauthenticated', async () => {
    m.identity = null;
    m.session = CANDIDATE_SESSION;
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it('denies a candidate session with no session cookie (must not upload)', async () => {
    m.session = CANDIDATE_SESSION;
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect(m.upload).not.toHaveBeenCalled();
  });

  it('denies a candidate session when the cookie belongs to a different session', async () => {
    m.session = CANDIDATE_SESSION;
    const res = await POST(makeRequest('other-session-id'));
    expect(res.status).toBe(403);
    expect(m.upload).not.toHaveBeenCalled();
  });

  it('grants a candidate session with the matching cookie (fails later on file validation)', async () => {
    m.session = CANDIDATE_SESSION;
    const res = await POST(makeRequest('sess-cand'));
    expect(res.status).toBe(400);
  });

  it('denies an interpreter session owned by a different interpreter', async () => {
    m.session = INTERPRETER_SESSION;
    m.identity = { role: 'interpreter', interpreterId: 999 };
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect(m.upload).not.toHaveBeenCalled();
  });

  it('grants an interpreter session owned by the caller (fails later on file validation)', async () => {
    m.session = INTERPRETER_SESSION;
    m.identity = { role: 'interpreter', interpreterId: 7 };
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
  });
});
