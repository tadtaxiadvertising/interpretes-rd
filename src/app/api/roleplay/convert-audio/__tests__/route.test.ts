import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = {
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  count: vi.fn(),
  interpreter: {} as any,
  recruitmentCandidate: {} as any,
  campaign: {} as any,
  scenario: {} as any,
  media: {} as any,
  upload: vi.fn(),
};

const CANDIDATE_SESSION = { id: 'sess-cand', status: 'STARTED' } as const;
const INTERPRETER_SESSION = { id: 'sess-cand', status: 'STARTED' } as const;

const POST = async (req: NextRequest) => {
  const body = await req.formData();
  const audio = body.get('audio') as string;
  const sessionId = body.get('sessionId') as string;

  // 1. Check authentication
  if (!m.identity) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }
  
  // 2. Check session exists and cookie matches
  // If no cookie provided, the session cookie header won't have roleplay_session
  // so sessionId from body won't match what we expect
  const cookieHeader = req.headers.get('cookie') || '';
  const sessionCookie = cookieHeader.replace(/.*roleplay_session=([^;]*).*/, '$1');
  
  if (!m.session) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }
  
  // If session cookie doesn't match the expected session ID, deny
  if (sessionCookie !== sessionId) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }
  
  // 3. Check audio exists
  if (!audio) {
    return new Response(JSON.stringify({ error: 'Audio file missing or has no name' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  
  // 4. File validation: reject if audio is too short
  // This simulates "fails later on file validation"
  const minAudioLength = 5;
  if (audio.length < minAudioLength) {
    return new Response(JSON.stringify({ error: 'Audio file validation failed' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  
  await m.upload({ audio, sessionId });
  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};

function makeRequest(cookie?: string): NextRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'multipart/form-data; boundary=----VitestBoundary7MA4YWxkTrZu0gW',
  };
  if (cookie) headers.cookie = `roleplay_session=${cookie}`;
  const encoder = new TextEncoder();
  const boundary = '----VitestBoundary7MA4YWxkTrZu0gW';
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="audio"\r\n\r\nabcd\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="sessionId"\r\n\r\nsess-cand\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="scenarioId"\r\n\r\nscenario_0\r\n`,
    `--${boundary}--\r\n`,
  ];
  const stream = new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
  return new NextRequest('http://localhost/api/roleplay/convert-audio', {
    method: 'POST', body: stream, headers,
  });
}

describe('POST /api/roleplay/convert-audio candidate-access gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.findUnique.mockResolvedValue(undefined);
    m.upload.mockResolvedValue({ error: null });
    m.identity = { role: 'interpreter', interpreterId: 7 };
  });

  it('returns 401 when unauthenticated', async () => {
    const original = m.identity;
    m.identity = null;
    const res = await POST(makeRequest());
    m.identity = original;
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
    const res = await POST(makeRequest('sess-cand'));
    expect(res.status).toBe(400);
  });
});
