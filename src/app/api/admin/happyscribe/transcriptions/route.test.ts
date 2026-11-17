import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  validateAction: vi.fn(),
  applyRateLimit: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('@/lib/auth/actions', () => ({
  validateAction: mocks.validateAction,
}));

vi.mock('@/lib/security/rate-limit', () => ({
  RATE_LIMITS: { audioUpload: { windowMs: 60_000, maxRequests: 20 } },
  applyRateLimit: mocks.applyRateLimit,
  createRateLimitHeaders: vi.fn(() => new Headers()),
}));

import { POST } from './route';

const transcriptionId = 'a'.repeat(32);
const exportId = 'b'.repeat(32);

function importRequest() {
  return new NextRequest('http://localhost/api/admin/happyscribe/transcriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: transcriptionId }),
  });
}

describe('HappyScribe SRT import download boundary', () => {
  beforeEach(() => {
    mocks.validateAction.mockReset().mockResolvedValue({ user: { userId: 'admin-test' } });
    mocks.applyRateLimit.mockReset().mockReturnValue({ success: true });
    mocks.fetch.mockReset();
    vi.stubGlobal('fetch', mocks.fetch);
    vi.stubEnv('HAPPY_SCRIBE_API_TOKEN', 'test-only-api-token');
    vi.stubEnv('HAPPY_SCRIBE_ORGANIZATION_ID', '123456');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('does not follow a redirect from an allowed download host to an internal URL', async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ state: 'done' }))
      .mockResolvedValueOnce(Response.json({ id: exportId }))
      .mockResolvedValueOnce(Response.json({
        state: 'ready',
        download_link: 'https://www.happyscribe.com/private/export.srt',
      }))
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { Location: 'http://127.0.0.1/internal' },
      }));

    const response = await POST(importRequest());

    expect(response.status).toBe(502);
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
    expect(mocks.fetch.mock.calls[3][1]).toMatchObject({ redirect: 'manual' });
    expect(mocks.fetch.mock.calls.every(([url]) =>
      !String(url).includes('127.0.0.1'))).toBe(true);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  it('accepts a direct HTTPS SRT from the approved host', async () => {
    const srt = '1\n00:00:00,000 --> 00:00:01,000\nDoctor: Hello\n';
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ state: 'done' }))
      .mockResolvedValueOnce(Response.json({ id: exportId }))
      .mockResolvedValueOnce(Response.json({
        state: 'ready',
        download_link: 'https://www.happyscribe.com/private/export.srt',
      }))
      .mockResolvedValueOnce(new Response(srt, { status: 200 }));

    const response = await POST(importRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { filename: 'happyscribe-import.srt', content: srt },
    });
    expect(mocks.fetch.mock.calls[3][1]).toMatchObject({ redirect: 'manual' });
  });

  it('denies non-admin access before any provider request', async () => {
    mocks.validateAction.mockResolvedValueOnce({ error: 'Forbidden' });

    const response = await POST(importRequest());

    expect(response.status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
