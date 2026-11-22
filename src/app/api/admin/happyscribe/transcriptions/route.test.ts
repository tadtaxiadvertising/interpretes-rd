import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { issueHappyScribeImportProof } from '@/lib/roleplay/happyscribe-import-proof';
import { getHappyScribeSettings } from '@/lib/roleplay/happyscribe-settings';
import { HAPPY_SCRIBE_LIST_MAX_BYTES, HAPPY_SCRIBE_PROBE_MAX_BYTES } from '@/lib/roleplay/happyscribe-probe';

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

  it('rejects an oversized signed import body before contacting HappyScribe', async () => {
    const request = new NextRequest('http://localhost/api/admin/happyscribe/transcriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: transcriptionId,
        proof: validProof(),
        padding: 'x'.repeat(9 * 1024),
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect((await response.json()).error).toContain('demasiado grande');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('returns a sanitized error for malformed import JSON without provider calls', async () => {
    const request = new NextRequest('http://localhost/api/admin/happyscribe/transcriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ "proof": "SYNTHETIC_PRIVATE_SECRET"',
    });
    const response = await POST(request);
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain('SYNTHETIC_PRIVATE_SECRET');
    expect(mocks.fetch).not.toHaveBeenCalled();
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

  it('rejects oversized transcription detail metadata without creating an SRT export', async () => {
    const cancel = vi.fn();
    mocks.fetch.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: { 'Content-Length': String(HAPPY_SCRIBE_LIST_MAX_BYTES + 1) },
    }));
    const response = await POST(importRequest());
    expect(response.status).toBe(502);
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect((await response.json()).error).toContain('demasiado grandes');
  });

  it('rejects oversized SRT export creation metadata without polling', async () => {
    const cancel = vi.fn();
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ state: 'done' }))
      .mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ cancel }), {
        headers: { 'Content-Length': String(HAPPY_SCRIBE_PROBE_MAX_BYTES + 1) },
      }));
    const response = await POST(importRequest());
    expect(response.status).toBe(502);
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect((await response.json()).error).toContain('exportación no válida');
  });

  it('does not continue polling after an oversized export status body', async () => {
    const cancel = vi.fn();
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ state: 'done' }))
      .mockResolvedValueOnce(Response.json({ id: exportId }))
      .mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(HAPPY_SCRIBE_PROBE_MAX_BYTES + 1)); },
        cancel,
      })));
    const response = await POST(importRequest());
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('5');
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it('rejects malformed detail metadata without starting an export', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('<html>synthetic upstream response</html>'));
    const response = await POST(importRequest());
    expect(response.status).toBe(502);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(JSON.stringify(await response.json())).not.toContain('synthetic upstream response');
  });

  it('cancels the provider detail body on a rejected transcription without leaking content', async () => {
    const cancel = vi.fn();
    mocks.fetch.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ cancel }), {
      status: 404,
    }));
    const response = await POST(importRequest());
    expect(response.status).toBe(404);
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(JSON.stringify(await response.json())).not.toContain('SYNTHETIC_PRIVATE_PROVIDER_DETAIL');
  });

  it('cancels a rejected SRT export-creation response before returning 502', async () => {
    const cancel = vi.fn();
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ state: 'done' }))
      .mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ cancel }), {
        status: 503,
      }));
    const response = await POST(importRequest());
    expect(response.status).toBe(502);
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(await response.json())).not.toContain('SYNTHETIC_PRIVATE_EXPORT_ERROR');
  });

  it('cancels a rejected export-status poll without repeatedly querying HappyScribe', async () => {
    const cancel = vi.fn();
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ state: 'done' }))
      .mockResolvedValueOnce(Response.json({ id: exportId }))
      .mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ cancel }), {
        status: 429,
      }));
    const response = await POST(importRequest());
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('5');
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it('preserves the correct error response when cancelling a rejected provider stream fails', async () => {
    const cancel = vi.fn(async () => { throw new Error('SYNTHETIC_PRIVATE_PROVIDER_ERROR'); });
    mocks.fetch.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ cancel }), {
      status: 401,
    }));
    const response = await POST(importRequest());
    expect(response.status).toBe(502);
    expect(cancel).toHaveBeenCalledOnce();
    expect(JSON.stringify(await response.json())).not.toContain('SYNTHETIC_PRIVATE_PROVIDER_ERROR');
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
    const body = await response.json();
    expect(body.error).toContain('limitó');
    expect(body.code).toBeUndefined();
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

  it('limits an overlong provider listing to 50 items and 50 signed selections', async () => {
    const results = Array.from({ length: 75 }, (_, i) => ({
      id: (i + 1).toString(16).padStart(32, '0'),
      name: 'Synthetic test transcript',
      state: 'done',
    }));
    mocks.fetch.mockResolvedValueOnce(Response.json({
      results,
      _links: { next: '/api/v1/transcriptions?page=1' },
    }));
    const response = await GET(new NextRequest('http://localhost/api/admin/happyscribe/transcriptions'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(50);
    expect(body.data[0].id).toBe(results[0].id);
    expect(body.data[49].id).toBe(results[49].id);
    expect(body.data.some((item: { id: string }) => item.id === results[50].id)).toBe(false);
    expect(body.data.every((item: { importProof: string }) =>
      /^\\d{13}\\.[a-f0-9]{64}$/.test(item.importProof))).toBe(true);
    expect(body.hasMore).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it('bounds provider catalog text fields before sending metadata to the browser', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({
      results: [{
        id: transcriptionId,
        name: 'N'.repeat(500),
        state: 'S'.repeat(600),
        language: 'L'.repeat(700),
        createdAt: 'C'.repeat(800),
        audioLengthInSeconds: -100,
        folder: { name: 'F'.repeat(900) },
      }],
    }));
    const response = await GET(new NextRequest('http://localhost/api/admin/happyscribe/transcriptions'));
    expect(response.status).toBe(200);
    const body = await response.json();
    const row = body.data[0];
    expect(row.name).toHaveLength(240);
    expect(row.state).toHaveLength(64);
    expect(row.language).toHaveLength(40);
    expect(row.createdAt).toHaveLength(64);
    expect(row.folder).toHaveLength(240);
    expect(row.durationSeconds).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledOnce();
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
    const body = await response.json();
    expect(body.error).toContain('HappyScribe');
    expect(body.code).toBe('HAPPYSCRIBE_CONFIGURATION_UNAVAILABLE');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
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
