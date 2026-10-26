// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  identity: { role: 'candidate', interpreterId: null } as any,
  sessionFindUnique: vi.fn(),
  scenarioFindFirst: vi.fn(),
  responseFindUnique: vi.fn(),
  storageUpload: vi.fn(),
  createSignedUrl: vi.fn(),
  queueMp3Conversion: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('@/lib/identity/resolve-user', () => ({
  resolveCurrentIdentity: vi.fn(async () => m.identity),
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    roleplaySession: { findUnique: m.sessionFindUnique },
    roleplayScenario: { findFirst: m.scenarioFindFirst },
    roleplayResponse: { findUnique: m.responseFindUnique },
  },
}));
vi.mock('@/lib/security/rate-limit', () => ({
  applyRateLimit: m.rateLimit,
  createRateLimitHeaders: vi.fn(() => ({})),
  RATE_LIMITS: { audioUpload: {} },
}));
vi.mock('@/lib/roleplay-audio-conversion', () => ({
  BUCKET: 'roleplay-audio',
  getSupabaseAdmin: () => ({
    storage: {
      from: () => ({
        upload: m.storageUpload,
        createSignedUrl: m.createSignedUrl,
      }),
    },
  }),
  queueMp3Conversion: m.queueMp3Conversion,
}));

import { POST } from '../route';

function makeRequest(options: { sessionId?: string; scenarioId?: string; cookie?: string; mime?: string; filename?: string } = {}) {
  const form = new FormData();
  const mime = options.mime ?? 'audio/webm';
  const filename = options.filename ?? `response.${mime === 'audio/mpeg' ? 'mp3' : mime === 'audio/ogg' ? 'ogg' : mime === 'audio/mp4' ? 'mp4' : 'webm'}`;
  form.append('audio', new File([new Uint8Array([1, 2, 3, 4, 5])], filename, { type: mime }));
  form.append('sessionId', options.sessionId ?? 'session-1');
  form.append('scenarioId', options.scenarioId ?? 'scenario-1');
  return new NextRequest('http://localhost/api/roleplay/convert-audio', {
    method: 'POST',
    body: form,
    headers: options.cookie ? { cookie: `roleplay_session=${options.cookie}` } : {},
  });
}

describe('POST /api/roleplay/convert-audio scenario ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.identity = { role: 'candidate', interpreterId: null };
    m.rateLimit.mockReturnValue({ success: true });
    m.sessionFindUnique.mockResolvedValue({
      id: 'session-1',
      interpreterId: null,
      recruitmentCandidateId: 42,
      status: 'STARTED',
      access: null,
    });
    m.scenarioFindFirst.mockResolvedValue({ id: 'scenario-1' });
    m.responseFindUnique.mockResolvedValue(null);
    m.storageUpload.mockResolvedValue({ error: null });
    m.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed.test/audio' }, error: null });
  });

  it('rejects a scenario that does not belong to the supplied session before storage upload', async () => {
    m.scenarioFindFirst.mockResolvedValue(null);

    const response = await POST(makeRequest({ cookie: 'session-1', scenarioId: 'scenario-from-other-session' }));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(m.scenarioFindFirst).toHaveBeenCalledWith({
      where: { id: 'scenario-from-other-session', sessionId: 'session-1' },
      select: { id: true },
    });
    expect(m.storageUpload).not.toHaveBeenCalled();
    expect(m.queueMp3Conversion).not.toHaveBeenCalled();
  });

  it('rejects uploads after a response has been confirmed, before touching storage', async () => {
    m.responseFindUnique.mockResolvedValue({ id: 'response-1' });

    const response = await POST(makeRequest({ cookie: 'session-1' }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toContain('already confirmed');
    expect(m.responseFindUnique).toHaveBeenCalledWith({
      where: { scenarioId: 'scenario-1' },
      select: { id: true },
    });
    expect(m.storageUpload).not.toHaveBeenCalled();
    expect(m.createSignedUrl).not.toHaveBeenCalled();
    expect(m.queueMp3Conversion).not.toHaveBeenCalled();
  });

  it('accepts a scenario owned by the authorized session', async () => {
    const response = await POST(makeRequest({ cookie: 'session-1' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(m.storageUpload).toHaveBeenCalledTimes(1);
    expect(body.data.sourcePath).toMatch(/^responses\/session-1\/scenario-1\/[0-9a-f-]{36}\.webm$/i);
    expect(m.storageUpload).toHaveBeenCalledWith(
      body.data.sourcePath,
      expect.any(File),
      expect.objectContaining({ contentType: 'audio/webm', upsert: false }),
    );
    expect(m.queueMp3Conversion).not.toHaveBeenCalled();
  });
  it('uses a different immutable object path for each upload attempt', async () => {
    const first = await POST(makeRequest({ cookie: 'session-1' }));
    const second = await POST(makeRequest({ cookie: 'session-1' }));
    const firstBody = await first.json();
    const secondBody = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstBody.data.sourcePath).not.toBe(secondBody.data.sourcePath);
    expect(m.storageUpload).toHaveBeenNthCalledWith(1, firstBody.data.sourcePath, expect.any(File), expect.objectContaining({ upsert: false }));
    expect(m.storageUpload).toHaveBeenNthCalledWith(2, secondBody.data.sourcePath, expect.any(File), expect.objectContaining({ upsert: false }));
  });

  it.each([
    ['audio/mpeg', 'response.mp3', 'mp3'],
    ['audio/ogg', 'response.ogg', 'ogg'],
    ['audio/mp4', 'response.mp4', 'mp4'],
  ])('stores %s using the matching .%s extension and does not queue WebM conversion', async (mime, filename, extension) => {
    const response = await POST(makeRequest({ cookie: 'session-1', mime, filename }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.sourcePath).toMatch(new RegExp(`^responses/session-1/scenario-1/[0-9a-f-]{36}\\.${extension}$`, 'i'));
    expect(m.storageUpload).toHaveBeenCalledWith(
      body.data.sourcePath,
      expect.any(File),
      expect.objectContaining({ contentType: mime, upsert: false }),
    );
    expect(m.queueMp3Conversion).not.toHaveBeenCalled();
  });

});
