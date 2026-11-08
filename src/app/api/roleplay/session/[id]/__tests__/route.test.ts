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
});
