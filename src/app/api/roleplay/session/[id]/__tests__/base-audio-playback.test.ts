import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  identity: null as any,
  session: null as any,
  findUnique: vi.fn(),
  getSignedAudioUrl: vi.fn(),
  actorFromBearer: vi.fn(),
}));
vi.mock('@/lib/identity/resolve-user', () => ({
  resolveCurrentIdentity: async () => m.identity,
}));
vi.mock('@/lib/api-auth', () => ({ actorFromBearer: m.actorFromBearer }));
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

const origin = 'https://project.supabase.co';
const path = 'base/session-a/0.mp3';
const legacy = `${origin}/storage/v1/object/public/roleplay-audio/${path}`;
const params = { params: Promise.resolve({ id: 'session-a' }) };
const request = () => new NextRequest('http://localhost/api/roleplay/session/session-a', {
  headers: { cookie: 'roleplay_session=session-a' },
});

const scenario = () => ({
  id: 'scenario-a', order: 0, title: 'Case A', baseAudioUrl: legacy,
  durationLimitSec: 120, scriptPrompt: null, responses: [],
});
const session = () => ({
  id: 'session-a', interpreterId: null, recruitmentCandidateId: 7,
  baseAudioUrl: legacy, baseAudioPath: null, recordedAudioUrl: null,
  status: 'STARTED', evaluatorId: null, qaScoreId: null,
  currentScenarioIndex: 0,
  access: { validatedAt: new Date(), usedAt: null },
  scenarios: [scenario()],
});

describe('authorized scenario base-audio playback', () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', origin);
    m.identity = { userId: 'candidate-user', role: 'candidate', candidateId: 7, interpreterId: null };
    m.session = session();
    m.findUnique.mockImplementation(async () => m.session);
    m.getSignedAudioUrl.mockImplementation(async (key: string) => `https://signed.test/${key}`);
  });

  it('renews both first-party session and scenario legacy URLs', async () => {
    const response = await GET(request(), params);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.baseAudioUrl).toBe(`https://signed.test/${path}`);
    expect(body.data.scenarios[0].baseAudioUrl).toBe(`https://signed.test/${path}`);
    expect(m.getSignedAudioUrl).toHaveBeenCalledTimes(2);
    expect(m.getSignedAudioUrl).toHaveBeenCalledWith(path, 3600);
  });

  it('does not sign a scenario before a candidate validates their invitation', async () => {
    m.session.access.validatedAt = null;
    const response = await GET(request(), params);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.baseAudioUrl).toBeNull();
    expect(body.data.scenarios[0].baseAudioUrl).toBe('');
    expect(m.getSignedAudioUrl).not.toHaveBeenCalled();
  });

  it('does not sign a scenario after invitation consumption', async () => {
    m.session.access.usedAt = new Date();
    const response = await GET(request(), params);
    const body = await response.json();
    expect(body.data.baseAudioUrl).toBeNull();
    expect(body.data.scenarios[0].baseAudioUrl).toBe('');
    expect(m.getSignedAudioUrl).not.toHaveBeenCalled();
  });

  it('never returns malformed first-party Storage links from scenarios', async () => {
    const untrusted = [
      `${legacy}?token=EXPIRED_PRIVATE_TOKEN`,
      `${origin}/storage/v1/object/public/other-bucket/base/session-a/0.mp3`,
      `${origin}/storage/v1/object/public/roleplay-audio/base/%2e%2e/other.mp3`,
      `${origin}/storage/v1/object/public/roleplay-audio/base/../other.mp3`,
    ];
    for (const url of untrusted) {
      m.getSignedAudioUrl.mockClear();
      m.session.baseAudioUrl = null;
      m.session.baseAudioPath = null;
      m.session.scenarios[0].baseAudioUrl = url;
      const response = await GET(request(), params);
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.data.scenarios[0].baseAudioUrl).toBe('');
      expect(JSON.stringify(body)).not.toContain('EXPIRED_PRIVATE_TOKEN');
      expect(m.getSignedAudioUrl).not.toHaveBeenCalled();
    }
  });

  it('never re-exposes rejected first-party audio for a consumed invitation', async () => {
    m.session.access.usedAt = new Date();
    m.session.scenarios[0].baseAudioUrl = `${legacy}?token=PRIVATE_TOKEN`;
    const response = await GET(request(), params);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.scenarios[0].baseAudioUrl).toBe('');
    expect(m.getSignedAudioUrl).not.toHaveBeenCalled();
  });

  it('leaves unrelated external legacy references untouched', async () => {
    m.session.baseAudioUrl = 'https://assets.example.test/unrelated.mp3';
    m.session.scenarios[0].baseAudioUrl = 'https://assets.example.test/unrelated.mp3';
    const response = await GET(request(), params);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.baseAudioUrl).toBe('https://assets.example.test/unrelated.mp3');
    expect(body.data.scenarios[0].baseAudioUrl).toBe('https://assets.example.test/unrelated.mp3');
    expect(m.getSignedAudioUrl).not.toHaveBeenCalled();
  });

  it('fails closed for a first-party Storage signing error', async () => {
    m.getSignedAudioUrl.mockRejectedValue(new Error('Storage signing unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await GET(request(), params);
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.data.baseAudioUrl).toBeNull();
      expect(body.data.scenarios[0].baseAudioUrl).toBe('');
      expect(body.data.scenarios[0].baseAudioUrl).not.toBe(legacy);
      expect(JSON.stringify(log.mock.calls)).not.toContain('Storage signing unavailable');
    } finally {
      log.mockRestore();
    }
  });
});
