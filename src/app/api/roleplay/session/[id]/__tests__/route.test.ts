import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  identity: null as any,
  session: null as any,
  findUnique: vi.fn(),
  getSignedAudioUrl: vi.fn(),
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

vi.mock('@/lib/roleplay', () => ({ getSignedAudioUrl: m.getSignedAudioUrl }));

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
    m.identity = { role: 'candidate', interpreterId: null, candidateId: 5 };
    m.session = candidateSession('STARTED');
    m.findUnique.mockImplementation(async () => m.session);
    m.getSignedAudioUrl.mockImplementation(async (path: string) => `https://signed.test/${path}`);
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

  it('does not expose evaluator expected keys to a candidate', async () => {
    m.session = {
      ...candidateSession('STARTED'),
      scenarios: [{
        id: 'scenario-1',
        order: 0,
        title: 'Scenario 1',
        baseAudioUrl: 'https://x/base.webm',
        durationLimitSec: 120,
        scriptPrompt: 'Candidate-facing prompt',
        expectedKeys: ['CONFIDENTIAL QA ANSWER'],
        responses: [],
      }],
    };

    const res = await GET(makeRequest('sess-1'), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.scenarios[0]).not.toHaveProperty('expectedKeys');
    expect(JSON.stringify(body)).not.toContain('CONFIDENTIAL QA ANSWER');
  });

  it('refreshes base audio playback URLs from the canonical Storage path', async () => {
    m.session = {
      ...candidateSession('STARTED'),
      baseAudioUrl: 'https://expired.example/base.webm',
      baseAudioPath: 'base/sess-1.webm',
    };

    const res = await GET(makeRequest('sess-1'), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(m.getSignedAudioUrl).toHaveBeenCalledWith('base/sess-1.webm', 60 * 60);
    expect(body.data.baseAudioUrl).toBe('https://signed.test/base/sess-1.webm');
  });

  it('refreshes playback URLs from canonical paths and prefers the processed MP3', async () => {
    m.session = {
      ...candidateSession('STARTED'),
      scenarios: [{
        id: 'scenario-1',
        order: 0,
        title: 'Scenario 1',
        baseAudioUrl: 'https://x/base.webm',
        durationLimitSec: 120,
        scriptPrompt: null,
        expectedKeys: [],
        responses: [{
          sourceAudioUrl: 'https://expired.example/old.webm',
          sourceAudioPath: 'responses/sess-1/scenario-1/source.webm',
          processedAudioPath: 'responses/sess-1/scenario-1/source.mp3',
          durationSec: 40,
          selfScore: null,
          selfNotes: null,
        }],
      }],
    };

    const res = await GET(makeRequest('sess-1'), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(m.getSignedAudioUrl).toHaveBeenCalledWith(
      'responses/sess-1/scenario-1/source.mp3',
      60 * 60,
    );
    expect(body.data.scenarios[0].responses[0].sourceAudioUrl)
      .toBe('https://signed.test/responses/sess-1/scenario-1/source.mp3');
    expect(body.data.scenarios[0].responses[0]).not.toHaveProperty('sourceAudioPath');
    expect(body.data.scenarios[0].responses[0]).not.toHaveProperty('processedAudioPath');
  });

  it('redacts legacy and signed response audio for an unvalidated candidate invitation', async () => {
    const original = candidateSession('SUBMITTED');
    m.session = {
      ...original,
      baseAudioUrl: 'https://private.example/base.mp3',
      baseAudioPath: 'base/sess-1.mp3',
      recordedAudioUrl: 'https://private.example/legacy-recording.webm',
      access: { ...original.access, validatedAt: null, usedAt: null },
      scenarios: [{
        id: 'scenario-1',
        order: 0,
        title: 'Clinical scenario',
        baseAudioUrl: 'https://private.example/clip.mp3',
        durationLimitSec: 120,
        scriptPrompt: null,
        expectedKeys: ['ADMIN ONLY'],
        responses: [{
          sourceAudioUrl: 'https://private.example/legacy-answer.webm',
          sourceAudioPath: 'responses/sess-1/answer.webm',
          processedAudioPath: 'responses/sess-1/answer.mp3',
          durationSec: 20,
          selfScore: null,
          selfNotes: null,
        }, {
          sourceAudioUrl: 'https://private.example/legacy-only.webm',
          sourceAudioPath: null,
          processedAudioPath: null,
          durationSec: 10,
          selfScore: null,
          selfNotes: null,
        }],
      }],
    };

    const res = await GET(makeRequest('sess-1'), { params });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.baseAudioUrl).toBeNull();
    expect(body.data.recordedAudioUrl).toBeNull();
    expect(body.data.scenarios[0].baseAudioUrl).toBe('');
    expect(body.data.scenarios[0].responses.map((r: { sourceAudioUrl: string | null }) => r.sourceAudioUrl))
      .toEqual([null, null]);
    expect(body.data.scenarios[0].responses[0]).not.toHaveProperty('sourceAudioPath');
    expect(body.data.scenarios[0].responses[0]).not.toHaveProperty('processedAudioPath');
    expect(JSON.stringify(body)).not.toContain('private.example');
    expect(JSON.stringify(body)).not.toContain('ADMIN ONLY');
    expect(m.getSignedAudioUrl).not.toHaveBeenCalled();
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('lets a submitted candidate review their own recording after invite consumption', async () => {
    const original = candidateSession('SUBMITTED');
    m.session = {
      ...original,
      baseAudioPath: 'base/sess-1.mp3',
      recordedAudioUrl: 'https://private.example/legacy-recording.webm',
      access: { ...original.access, usedAt: new Date() },
      scenarios: [{
        id: 'scenario-1',
        order: 0,
        title: 'Clinical scenario',
        baseAudioUrl: 'https://private.example/clip.mp3',
        durationLimitSec: 120,
        scriptPrompt: null,
        expectedKeys: [],
        responses: [{
          sourceAudioUrl: 'https://private.example/old.webm',
          sourceAudioPath: 'responses/sess-1/answer.webm',
          processedAudioPath: 'responses/sess-1/answer.mp3',
          durationSec: 20,
          selfScore: null,
          selfNotes: null,
        }],
      }],
    };
    const res = await GET(makeRequest('sess-1'), { params });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.status).toBe('SUBMITTED');
    expect(body.data.baseAudioUrl).toBeNull();
    expect(body.data.recordedAudioUrl).toBeNull();
    expect(body.data.scenarios[0].baseAudioUrl).toBe('');
    expect(body.data.canCompleteSelfAssessment).toBe(true);
    expect(m.getSignedAudioUrl).toHaveBeenCalledWith('responses/sess-1/answer.mp3', 3600);
    expect(m.getSignedAudioUrl).not.toHaveBeenCalledWith('base/sess-1.mp3', 3600);
    expect(body.data.scenarios[0].responses[0].sourceAudioUrl)
      .toBe('https://signed.test/responses/sess-1/answer.mp3');
  });

  it('preserves administrator playback access even when a candidate invitation is consumed', async () => {
    m.identity = { role: 'admin', interpreterId: null, candidateId: null };
    m.session = {
      ...candidateSession('SUBMITTED'),
      access: { tokenHash: 'h', validatedAt: new Date(), usedAt: new Date() },
      scenarios: [{
        id: 'scenario-1',
        order: 0,
        title: 'Scenario',
        baseAudioUrl: 'https://private.example/clip.mp3',
        durationLimitSec: 120,
        scriptPrompt: null,
        expectedKeys: [],
        responses: [{
          sourceAudioUrl: 'https://private.example/old.webm',
          sourceAudioPath: 'responses/sess-1/source.webm',
          processedAudioPath: null,
          durationSec: 25,
          selfScore: null,
          selfNotes: null,
        }],
      }],
    };
    const res = await GET(makeRequest(), { params });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(m.getSignedAudioUrl).toHaveBeenCalledWith('responses/sess-1/source.webm', 3600);
    expect(body.data.scenarios[0].responses[0].sourceAudioUrl)
      .toBe('https://signed.test/responses/sess-1/source.webm');
  });

  it('keeps evaluator expected keys available to administrators', async () => {
    m.identity = { role: 'admin', interpreterId: null, candidateId: null };
    m.session = {
      ...candidateSession('STARTED'),
      scenarios: [{
        id: 'scenario-1',
        order: 0,
        title: 'Scenario 1',
        baseAudioUrl: 'https://x/base.webm',
        durationLimitSec: 120,
        scriptPrompt: 'Candidate-facing prompt',
        expectedKeys: ['ADMIN QA KEY'],
        responses: [],
      }],
    };

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.scenarios[0].expectedKeys).toEqual(['ADMIN QA KEY']);
  });

  it('lets the bound candidate reload a submitted attempt (read-only)', async () => {
    m.session = candidateSession('SUBMITTED');

    const res = await GET(makeRequest('sess-1'), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.status).toBe('SUBMITTED');
  });

  it('offers recovery only for a submitted attempt with missing self-assessment', async () => {
    m.session = {
      ...candidateSession('SUBMITTED'),
      scenarios: [{
        id: 'scenario-1',
        order: 0,
        title: 'Scenario 1',
        baseAudioUrl: 'https://x/base.webm',
        durationLimitSec: 120,
        scriptPrompt: null,
        expectedKeys: [],
        responses: [{ sourceAudioUrl: 'https://x/response.webm', durationSec: 40, selfScore: { fluency: 8 }, selfNotes: null }],
      }],
    };

    const res = await GET(makeRequest('sess-1'), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.canCompleteSelfAssessment).toBe(true);
    expect(body.data.scenarios[0]).not.toHaveProperty('expectedKeys');
  });

  it('offers submitted-candidate recovery when only the canonical response Storage path remains', async () => {
    m.session = {
      ...candidateSession('SUBMITTED'),
      scenarios: [{
        id: 'scenario-1',
        order: 0,
        title: 'Scenario',
        baseAudioUrl: 'https://x/base.webm',
        durationLimitSec: 120,
        scriptPrompt: null,
        expectedKeys: [],
        responses: [{
          sourceAudioUrl: null,
          sourceAudioPath: 'responses/sess-1/scenario-1/source.webm',
          processedAudioPath: null,
          durationSec: 25,
          selfScore: { fluency: 7 },
          selfNotes: null,
        }],
      }],
    };
    const res = await GET(makeRequest('sess-1'), { params });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.canCompleteSelfAssessment).toBe(true);
    expect(m.getSignedAudioUrl).toHaveBeenCalledWith('responses/sess-1/scenario-1/source.webm', 3600);
    expect(body.data.scenarios[0].responses[0].sourceAudioUrl)
      .toBe('https://signed.test/responses/sess-1/scenario-1/source.webm');
    expect(body.data.scenarios[0].responses[0]).not.toHaveProperty('sourceAudioPath');
  });

  it('rejects an interpreter who does not own the session', async () => {
    m.session = { ...candidateSession('STARTED'), recruitmentCandidateId: null, interpreterId: 7 };
    m.identity = { role: 'interpreter', interpreterId: 999 };

    const res = await GET(makeRequest(), { params });

    expect(res.status).toBe(403);
  });

  it('does not let a legacy interpreterId override candidate ownership', async () => {
    m.session = { ...candidateSession('STARTED'), interpreterId: 7 };
    m.identity = { role: 'interpreter', interpreterId: 7, candidateId: null };

    const res = await GET(makeRequest('sess-1'), { params });

    expect(res.status).toBe(403);
  });

  it('allows the candidate owner to read a dual-linked legacy session', async () => {
    m.session = { ...candidateSession('STARTED'), interpreterId: 7 };

    const res = await GET(makeRequest('sess-1'), { params });

    expect(res.status).toBe(200);
  });

  it('does not log or return private URLs when Storage signature refresh fails', async () => {
    const secret = 'https://internal-storage.invalid/audio?token=secret-storage-token';
    m.session = {
      ...candidateSession('STARTED'),
      baseAudioPath: 'base/sess-1.webm',
      scenarios: [{
        id: 'scenario-1',
        order: 0,
        title: 'Scenario',
        baseAudioUrl: 'https://legacy.example/clip.webm',
        durationLimitSec: 120,
        scriptPrompt: null,
        expectedKeys: [],
        responses: [{
          sourceAudioUrl: 'https://old.example/audio.webm',
          sourceAudioPath: 'responses/sess-1/audio.webm',
          processedAudioPath: null,
          durationSec: 25,
          selfScore: null,
          selfNotes: null,
        }],
      }],
    };
    m.getSignedAudioUrl.mockRejectedValue(new Error(secret));
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await GET(makeRequest('sess-1'), { params });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data.baseAudioUrl).toBeNull();
      expect(body.data.scenarios[0].responses[0].sourceAudioUrl).toBeNull();
      expect(JSON.stringify(body)).not.toContain('secret-storage-token');
      expect(JSON.stringify(logs.mock.calls)).not.toContain('secret-storage-token');
      expect(JSON.stringify(logs.mock.calls)).not.toContain('internal-storage.invalid');
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    } finally {
      logs.mockRestore();
    }
  });

  it('never exposes internal database errors in participant API responses', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      m.findUnique.mockRejectedValueOnce(
        new Error('postgresql://private-admin:secret@private-db.example/roleplay'),
      );

      const res = await GET(makeRequest('sess-1'), { params });
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error).toBe('No fue posible cargar la sesión. Inténtalo nuevamente.');
      expect(JSON.stringify(body)).not.toContain('secret');
      expect(JSON.stringify(body)).not.toContain('private-db.example');
      expect(JSON.stringify(log.mock.calls)).not.toContain('private-db.example');
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    } finally {
      log.mockRestore();
    }
  });

  it('marks authorized session responses private and uncacheable', async () => {
    const res = await GET(makeRequest('sess-1'), { params });

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toBe('Cookie');
  });

  it('returns 401 to an anonymous user before accessing a private session', async () => {
    m.identity = null;
    const res = await GET(makeRequest('sess-1'), { params });

    expect(res.status).toBe(401);
    expect(m.findUnique).not.toHaveBeenCalled();
  });

  it('allows the owning interpreter to read an interpreter-only roleplay without a candidate cookie', async () => {
    m.session = {
      ...candidateSession('IN_PROGRESS'),
      recruitmentCandidateId: null,
      interpreterId: 21,
      scenarios: [{
        id: 'scenario-1',
        order: 0,
        title: 'English to Spanish',
        baseAudioUrl: 'https://example.test/base.mp3',
        durationLimitSec: 120,
        scriptPrompt: 'Interpret accurately',
        expectedKeys: ['EVALUATOR PRIVATE ANSWER'],
        responses: [],
      }],
    };
    m.identity = { role: 'interpreter', interpreterId: 21, candidateId: null };

    const res = await GET(makeRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.scenarios).toHaveLength(1);
    expect(body.data.scenarios[0]).not.toHaveProperty('expectedKeys');
    expect(JSON.stringify(body)).not.toContain('EVALUATOR PRIVATE ANSWER');
  });

  it('denies a different candidate even when they have the correct session cookie', async () => {
    m.identity = { role: 'candidate', candidateId: 99, interpreterId: null };
    const res = await GET(makeRequest('sess-1'), { params });

    expect(res.status).toBe(403);
  });

  it('denies candidates access to interpreter-only sessions', async () => {
    m.session = { ...candidateSession('IN_PROGRESS'), recruitmentCandidateId: null, interpreterId: 5 };
    m.identity = { role: 'candidate', candidateId: 5, interpreterId: null };
    const res = await GET(makeRequest('sess-1'), { params });

    expect(res.status).toBe(403);
  });

  it.each(['CANCELLED', 'EXPIRED'])(
    'denies an interpreter access to their own %s attempt',
    async (status) => {
      m.session = {
        ...candidateSession(status),
        recruitmentCandidateId: null,
        interpreterId: 21,
      };
      m.identity = { role: 'interpreter', interpreterId: 21, candidateId: null };
      const res = await GET(makeRequest(), { params });
      expect(res.status).toBe(403);
      expect(m.getSignedAudioUrl).not.toHaveBeenCalled();
    },
  );

  it('retains administrator read access to a cancelled interpreter attempt for audit', async () => {
    m.session = {
      ...candidateSession('CANCELLED'),
      recruitmentCandidateId: null,
      interpreterId: 21,
    };
    m.identity = { role: 'admin', interpreterId: null, candidateId: null };
    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe('CANCELLED');
  });

  it('denies candidates access to a cancelled attempt even if they own its cookie', async () => {
    m.session = candidateSession('CANCELLED');
    const res = await GET(makeRequest('sess-1'), { params });

    expect(res.status).toBe(403);
  });

});
