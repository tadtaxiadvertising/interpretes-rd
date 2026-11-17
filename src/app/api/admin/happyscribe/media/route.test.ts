import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  validateAction: vi.fn(),
  applyRateLimit: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('@/lib/auth/actions', () => ({ validateAction: mocks.validateAction }));
vi.mock('@/lib/security/rate-limit', () => ({
  RATE_LIMITS: { audioUpload: { windowMs: 60_000, maxRequests: 3 } },
  applyRateLimit: mocks.applyRateLimit,
  createRateLimitHeaders: vi.fn(() => new Headers()),
}));

import { POST } from './route';

const transcriptionId = 'a'.repeat(32);

function request() {
  return new NextRequest('http://localhost/api/admin/happyscribe/media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: transcriptionId }),
  });
}

describe('HappyScribe original media import', () => {
  beforeEach(() => {
    mocks.validateAction.mockReset().mockResolvedValue({ user: { userId: 'admin-test' } });
    mocks.applyRateLimit.mockReset().mockReturnValue({ success: true });
    mocks.fetch.mockReset();
    vi.stubGlobal('fetch', mocks.fetch);
    vi.stubEnv('HAPPY_SCRIBE_API_TOKEN', 'test-only-token');
    vi.stubEnv('HAPPY_SCRIBE_MEDIA_PROXY_ENABLED', 'true');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('does not contact the provider unless media proxy is explicitly enabled', async () => {
    vi.stubEnv('HAPPY_SCRIBE_MEDIA_PROXY_ENABLED', 'false');
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('streams a completed transcription MP3 without exposing its signed URL', async () => {
    const audio = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]);
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ state: 'automatic_done' }))
      .mockResolvedValueOnce(Response.json({
        state: 'ready', download_link: 'https://media.happyscribe.com/audio.mp3?signature=secret',
      }))
      .mockResolvedValueOnce(new Response(audio, {
        headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(audio.byteLength) },
      }));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Content-Disposition')).toContain('happyscribe-audio.mp3');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(audio);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(response.headers.get('Content-Disposition')).not.toContain('signature=secret');
  });

  it('does not export locked or unfinished audio', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ state: 'locked' }));

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects non-admins before calling HappyScribe', async () => {
    mocks.validateAction.mockResolvedValueOnce({ error: 'Forbidden' });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects unsafe provider destinations', async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ state: 'automatic_done' }))
      .mockResolvedValueOnce(Response.json({
        state: 'ready', download_link: 'http://127.0.0.1/private.mp3',
      }));

    const response = await POST(request());

    expect(response.status).toBe(502);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects a provider audio export larger than the direct-import limit', async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ state: 'automatic_done' }))
      .mockResolvedValueOnce(Response.json({
        state: 'ready', download_link: 'https://media.happyscribe.com/audio.mp3',
      }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0x49]), {
        headers: { 'Content-Length': String(250 * 1024 * 1024 + 1) },
      }));

    const response = await POST(request());

    expect(response.status).toBe(413);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

});
