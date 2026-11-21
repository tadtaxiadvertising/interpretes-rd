import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { issueHappyScribeImportProof } from '@/lib/roleplay/happyscribe-import-proof';
import { getHappyScribeSettings } from '@/lib/roleplay/happyscribe-settings';

const mocks = vi.hoisted(() => ({
  validateAction: vi.fn(),
  actorFromBearer: vi.fn(),
  applyRateLimit: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('@/lib/auth/actions', () => ({
  validateAction: mocks.validateAction,
}));

vi.mock('@/lib/api-auth', () => ({ actorFromBearer: mocks.actorFromBearer }));
vi.mock('@/lib/roleplay/happyscribe-settings', () => ({
  getHappyScribeSettings: vi.fn(async () => ({
    token: process.env.HAPPY_SCRIBE_API_TOKEN || '',
    organizationId: process.env.HAPPY_SCRIBE_ORGANIZATION_ID || '',
    mediaImportEnabled: process.env.HAPPY_SCRIBE_MEDIA_PROXY_ENABLED === 'true',
  })),
}));

vi.mock('@/lib/security/rate-limit', () => ({
  RATE_LIMITS: { audioUpload: { windowMs: 60_000, maxRequests: 20 } },
  applyRateLimit: mocks.applyRateLimit,
  createRateLimitHeaders: vi.fn(() => new Headers()),
}));

import { GET, POST } from './route';

const transcriptionId = 'a'.repeat(32);
const organizationId = '123456';
const userId = 'admin-test';
function validProof() {
  return issueHappyScribeImportProof({
    id: transcriptionId,
    organizationId, userId,
    token: process.env.HAPPY_SCRIBE_API_TOKEN || '',
  });
}
const exportId = 'b'.repeat(32);

function importRequest(signal?: AbortSignal) {
  return new NextRequest('http://localhost/api/admin/happyscribe/transcriptions', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: transcriptionId, proof: validProof() }),
  });
}

describe('HappyScribe SRT import download boundary', () => {
  beforeEach(() => {
    mocks.actorFromBearer.mockReset();
    mocks.validateAction.mockReset().mockResolvedValue({ user: { userId: 'admin-test' } });
    mocks.applyRateLimit.mockReset().mockReturnValue({ success: true });
    mocks.fetch.mockReset();
    vi.stubGlobal('fetch', mocks.fetch);
    vi.stubEnv('HAPPY_SCRIBE_API_TOKEN', 'test-only-api-token');
    vi.stubEnv('HAPPY_SCRIBE_ORGANIZATION_ID', organizationId);
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

  it('cancels an oversized SRT response immediately instead of leaving the download open', async () => {
    const cancel = vi.fn();
    const oversized = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: { 'Content-Length': '5000001' },
    });
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ state: 'done' }))
      .mockResolvedValueOnce(Response.json({ id: exportId }))
      .mockResolvedValueOnce(Response.json({
        state: 'ready', download_link: 'https://www.happyscribe.com/private/large.srt',
      }))
      .mockResolvedValueOnce(oversized);

    const response = await POST(importRequest());
    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
  });

  it('still responds 413 if cancelling an oversized SRT fails', async () => {
    const cancel = vi.fn(async () => { throw new Error('provider cleanup failed'); });
    const oversized = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: { 'Content-Length': '5000001' },
    });
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ state: 'done' }))
      .mockResolvedValueOnce(Response.json({ id: exportId }))
      .mockResolvedValueOnce(Response.json({
        state: 'ready', download_link: 'https://www.happyscribe.com/private/large.srt',
      }))
      .mockResolvedValueOnce(oversized);

    const response = await POST(importRequest());
    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('releases a rejected provider response without forwarding upstream error text', async () => {
    const cancel = vi.fn();
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ state: 'done' }))
      .mockResolvedValueOnce(Response.json({ id: exportId }))
      .mockResolvedValueOnce(Response.json({
        state: 'ready', download_link: 'https://www.happyscribe.com/private/error.srt',
      }))
      .mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ cancel }), {
        status: 502,
      }));
    const response = await POST(importRequest());
    expect(response.status).toBe(502);
    expect(cancel).toHaveBeenCalledOnce();
    expect(JSON.stringify(await response.json())).not.toContain('private/error.srt');
  });

  it('stops SRT polling when the administrator cancels the HTTP request', async () => {
    const controller = new AbortController();
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ state: 'done' }))
      .mockResolvedValueOnce(Response.json({ id: exportId }))
      .mockImplementationOnce(async () => {
        queueMicrotask(() => controller.abort());
        return Response.json({ state: 'processing' });
      });

    const response = await POST(importRequest(controller.signal));
    expect(response.status).toBe(502);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(controller.signal.aborted).toBe(true);
    for (const [, init] of mocks.fetch.mock.calls) {
      expect((init as RequestInit).signal).toBeDefined();
      expect(((init as RequestInit).signal as AbortSignal).aborted).toBe(true);
    }
  });

  it('preserves the SRT size-limit response when cancellation after reading fails', async () => {
    const cancel = vi.fn(async () => { throw new Error('provider stream gone'); });
    const oversized = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(5_000_001)); },
      cancel,
    }));
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ state: 'done' }))
      .mockResolvedValueOnce(Response.json({ id: exportId }))
      .mockResolvedValueOnce(Response.json({
        state: 'ready', download_link: 'https://www.happyscribe.com/private/oversize.srt',
      }))
      .mockResolvedValueOnce(oversized);

    const response = await POST(importRequest());
    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('denies non-admin access before any provider request', async () => {
    mocks.validateAction.mockResolvedValueOnce({ error: 'Forbidden' });

    const response = await POST(importRequest());

    expect(response.status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('denies a different administrator Bearer on the library GET before provider calls', async () => {
    mocks.actorFromBearer.mockResolvedValue({ userId: 'other-admin', role: 'admin' });
    const mixedRequest = new NextRequest('http://localhost/api/admin/happyscribe/transcriptions', {
      headers: { Authorization: 'Bearer other-admin-token' },
    });

    const response = await GET(mixedRequest);

    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(mocks.applyRateLimit).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('denies an invalid explicit Bearer on SRT POST even when the admin cookie exists', async () => {
    mocks.actorFromBearer.mockResolvedValue(null);
    const mixedRequest = new NextRequest('http://localhost/api/admin/happyscribe/transcriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer invalid-token' },
      body: JSON.stringify({ id: transcriptionId, proof: validProof() }),
    });

    const response = await POST(mixedRequest);

    expect(response.status).toBe(403);
    expect(mocks.applyRateLimit).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('releases rejected upstream streams without disclosing provider errors', async () => {
    const cancel = vi.fn();
    mocks.fetch.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ cancel }), {
      status: 429,
    }));
    const response = await GET(new NextRequest(
      'http://localhost/api/admin/happyscribe/transcriptions?check=1',
    ));
    expect(response.status).toBe(503);
    expect(cancel).toHaveBeenCalledOnce();
    expect((await response.json()).error).toContain('limitó');
  });

  it('checks connectivity without returning transcription metadata to the admin settings form', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({
      results: [{ id: transcriptionId, name: 'SYNTHETIC_PRIVATE_TITLE' }],
    }));
    const response = await GET(new NextRequest(
      'http://localhost/api/admin/happyscribe/transcriptions?check=1',
    ));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, ready: true });
    expect(JSON.stringify(body)).not.toContain('SYNTHETIC_PRIVATE_TITLE');
    expect(String(mocks.fetch.mock.calls[0][0])).toContain('per_page=1');
    expect(String(mocks.fetch.mock.calls[0][0])).toContain('organization_id=123456');
  });

  it('rejects an invalid provider response during the connection check', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('<html>Not an API</html>', { status: 200 }));
    const response = await GET(new NextRequest(
      'http://localhost/api/admin/happyscribe/transcriptions?check=1',
    ));
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain('<html>');
  });


  it('returns a signed selection from the organization-filtered listing', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({
      results: [{ id: transcriptionId, name: 'Synthetic test transcript', state: 'done' }],
    }));
    const response = await GET(new NextRequest('http://localhost/api/admin/happyscribe/transcriptions'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].importProof).toMatch(/^\d{13}\.[a-f0-9]{64}$/);
    expect(JSON.stringify(body)).not.toContain('test-only-api-token');
    expect(String(mocks.fetch.mock.calls[0][0])).toContain('organization_id=123456');
  });

  it('rejects an SRT export without a scoped selection, without contacting the provider', async () => {
    const unverified = new NextRequest('http://localhost/api/admin/happyscribe/transcriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: transcriptionId }),
    });
    const response = await POST(unverified);
    expect(response.status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects an SRT selection issued for another organization', async () => {
    const proof = issueHappyScribeImportProof({
      id: transcriptionId, organizationId: '999999', userId, token: process.env.HAPPY_SCRIBE_API_TOKEN || '',
    });
    const req = new NextRequest('http://localhost/api/admin/happyscribe/transcriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: transcriptionId, proof }),
    });
    const response = await POST(req);
    expect(response.status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('returns a safe 503 rather than an unhandled error if provider settings fail to load', async () => {
    vi.mocked(getHappyScribeSettings).mockRejectedValueOnce(new Error('synthetic unavailable credentials'));
    const response = await GET(new NextRequest('http://localhost/api/admin/happyscribe/transcriptions'));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain('HappyScribe');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });


  it('bounds an oversized library catalog and never creates an import proof', async () => {
    const cancel = vi.fn();
    const upstream = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
      cancel,
    }));
    mocks.fetch.mockResolvedValueOnce(upstream);

    const response = await GET(new NextRequest('http://localhost/api/admin/happyscribe/transcriptions'));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain('lista no válida');
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });


});
