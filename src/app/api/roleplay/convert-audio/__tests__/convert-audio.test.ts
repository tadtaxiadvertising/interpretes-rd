// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  identity: { role: 'candidate', candidateId: 5, interpreterId: null } as any,
  findSession: vi.fn(),
  findScenario: vi.fn(),
  findResponse: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('@/lib/identity/resolve-user', () => ({
  resolveCurrentIdentity: async () => mocks.identity,
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    roleplaySession: { findUnique: mocks.findSession },
    roleplayScenario: { findFirst: mocks.findScenario },
    roleplayResponse: { findUnique: mocks.findResponse },
  },
}));
vi.mock('@/lib/security/rate-limit', () => ({
  applyRateLimit: () => ({ success: true }),
  createRateLimitHeaders: () => ({}),
  RATE_LIMITS: { audioUpload: {} },
}));
vi.mock('@/lib/roleplay-audio-conversion', () => ({
  BUCKET: 'roleplay-audio',
  getSupabaseAdmin: () => ({
    storage: {
      from: () => ({ upload: mocks.upload, remove: mocks.remove }),
    },
  }),
}));
vi.mock('@/app/actions/roleplay', () => ({
  confirmRoleplayResponse: mocks.confirm,
}));

import { POST } from '../route';

function makeRequest(options: {
  mimeType?: string;
  cookie?: string;
  scenarioId?: string;
} = {}) {
  const form = new FormData();
  form.set('audio', new File([new Uint8Array([1, 2, 3, 4])], 'response.webm', {
    type: options.mimeType ?? 'audio/webm',
  }));
  form.set('sessionId', 'session-1');
  form.set('scenarioId', options.scenarioId ?? 'scenario-1');
  return new NextRequest('http://localhost/api/roleplay/convert-audio', {
    method: 'POST',
    body: form,
    headers: options.cookie ? { cookie: `roleplay_session=${options.cookie}` } : {},
  });
}

describe('POST /api/roleplay/convert-audio legacy compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identity = { role: 'candidate', candidateId: 5, interpreterId: null };
    mocks.findSession.mockResolvedValue({
      id: 'session-1',
      interpreterId: null,
      recruitmentCandidateId: 5,
      status: 'IN_PROGRESS',
      access: { usedAt: null, validatedAt: new Date(), startedAt: new Date() },
    });
    mocks.findScenario.mockResolvedValue({ id: 'scenario-1' });
    mocks.findResponse.mockResolvedValue(null);
    mocks.upload.mockResolvedValue({ error: null });
    mocks.remove.mockResolvedValue({ error: null });
    mocks.confirm.mockResolvedValue({
      success: true,
      data: { recordedAudioUrl: 'https://signed.test/response', sourceAudioPath: 'responses/session-1/scenario-1/00000000-0000-4000-8000-000000000001.webm' },
    });
  });

  it('persists a legacy multipart upload through the canonical confirmation action', async () => {
    const response = await POST(makeRequest({ cookie: 'session-1' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Vary')).toBe('Cookie');
    expect(body).toMatchObject({
      success: true,
      data: { sourceUrl: 'https://signed.test/response', audioStatus: 'UPLOADED' },
    });
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      scenarioId: 'scenario-1',
      sourceAudioPath: expect.stringMatching(/^responses\/session-1\/scenario-1\/.+\.webm$/),
    }));
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('removes the uploaded object when transactional confirmation fails', async () => {
    mocks.confirm.mockResolvedValue({
      success: false,
      error: 'Response already recorded for this scenario',
      code: 'INTERNAL_ERROR',
    });

    const response = await POST(makeRequest({ cookie: 'session-1' }));

    expect(response.status).toBe(400);
    expect(mocks.remove).toHaveBeenCalledWith(expect.arrayContaining([
      expect.stringMatching(/^responses\/session-1\/scenario-1\//),
    ]));
  });

  it('rejects a scenario outside the supplied session before uploading', async () => {
    mocks.findScenario.mockResolvedValue(null);

    const response = await POST(makeRequest({ cookie: 'session-1', scenarioId: 'foreign-scenario' }));

    expect(response.status).toBe(404);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it.each([
    { validatedAt: null, usedAt: null, reason: 'never validated' },
    { validatedAt: new Date(), usedAt: new Date(), reason: 'already consumed' },
    { validatedAt: null, usedAt: new Date(), reason: 'invalid and consumed' },
  ])('blocks uploads for a candidate invitation that is $reason', async ({ validatedAt, usedAt }) => {
    mocks.findSession.mockResolvedValueOnce({
      id: 'session-1',
      interpreterId: null,
      recruitmentCandidateId: 5,
      status: 'IN_PROGRESS',
      access: { validatedAt, usedAt, startedAt: new Date() },
    });
    const response = await POST(makeRequest({ cookie: 'session-1' }));
    expect(response.status).toBe(403);
    expect((await response.json()).success).toBe(false);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.findScenario).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('keeps interpreter-owned recordings available without candidate invite data', async () => {
    mocks.identity = { role: 'interpreter', interpreterId: 7, candidateId: null };
    mocks.findSession.mockResolvedValueOnce({
      id: 'session-1',
      interpreterId: 7,
      recruitmentCandidateId: null,
      status: 'IN_PROGRESS',
      access: null,
    });
    const response = await POST(makeRequest());
    expect(response.status).toBe(200);
    expect(mocks.upload).toHaveBeenCalledOnce();
  });

  it('rejects candidate uploads without the session-bound cookie', async () => {
    const response = await POST(makeRequest());

    expect(response.status).toBe(403);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('rejects unsupported WebM codec parameters', async () => {
    const response = await POST(makeRequest({ cookie: 'session-1', mimeType: 'audio/webm;codecs=unknown' }));

    expect(response.status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('does not cache errors or log internal database credentials on audio upload failure', async () => {
    const secret = 'postgresql://private:password@db.internal.invalid/roleplay';
    mocks.confirm.mockRejectedValue(new Error(secret));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await POST(makeRequest({ cookie: 'session-1' }));
      const body = await response.json();
      expect(response.status).toBe(500);
      expect(body).toEqual({ success: false, error: 'Unable to process audio upload' });
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(response.headers.get('Vary')).toBe('Cookie');
      expect(JSON.stringify(body)).not.toContain('password');
      expect(JSON.stringify(log.mock.calls)).not.toContain('password');
      expect(JSON.stringify(log.mock.calls)).not.toContain('db.internal.invalid');
    } finally {
      log.mockRestore();
    }
  });

  it('does not log provider tokens when cleanup of an unconfirmed upload fails', async () => {
    mocks.confirm.mockResolvedValue({
      success: false,
      code: 'CONFLICT',
      error: 'Response already recorded for this scenario',
    });
    mocks.remove.mockResolvedValue({ error: { message: 'https://storage.invalid?token=PRIVATE_TOKEN' } });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await POST(makeRequest({ cookie: 'session-1' }));
      expect(response.status).toBe(409);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(JSON.stringify(await response.json())).not.toContain('PRIVATE_TOKEN');
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_TOKEN');
      expect(JSON.stringify(log.mock.calls)).not.toContain('storage.invalid');
    } finally {
      log.mockRestore();
    }
  });

  it('does not allow administrators to create participant response recordings', async () => {
    mocks.identity = { role: 'admin', candidateId: null, interpreterId: null };

    const response = await POST(makeRequest({ cookie: 'session-1' }));

    expect(response.status).toBe(403);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
