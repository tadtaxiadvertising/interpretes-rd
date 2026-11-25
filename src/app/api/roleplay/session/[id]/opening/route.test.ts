import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  identity: vi.fn(), bearer: vi.fn(), application: vi.fn(), ip: vi.fn(), quota: vi.fn(),
  authorize: vi.fn(), confirm: vi.fn(), recover: vi.fn(), discard: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ default: { recruitmentApplication: { findUnique: m.application } } }));
vi.mock('@/lib/identity/resolve-user', () => ({ resolveCurrentIdentity: m.identity }));
vi.mock('@/lib/api-auth', () => ({ actorFromBearer: m.bearer }));
vi.mock('@/lib/security/rate-limit', () => ({
  applyRateLimit: m.ip, rateLimit: m.quota, createRateLimitHeaders: () => ({ 'Retry-After': '60' }),
}));
vi.mock('@/lib/roleplay/bilingual-opening-service', () => ({
  authorizeOpeningUpload: m.authorize, confirmOpeningUpload: m.confirm, recoverOpeningDetails: m.recover, discardOpeningUpload: m.discard,
}));

import { GET, POST } from './route';
import { BilingualOpeningStoreError } from '@/lib/roleplay/bilingual-opening-store';

const params = { params: Promise.resolve({ id: 'session-1' }) };
const identity = { userId: 'user-1', role: 'candidate', candidateId: 7, interpreterId: null };
const path = 'openings/session-1/123e4567-e89b-42d3-a456-426614174000.webm';
function request(body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('https://example.test/api/roleplay/session/session-1/opening', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie: 'roleplay_session=session-1', 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('ROLEPLAY_BILINGUAL_OPENING_API_ENABLED', 'true');
  m.identity.mockResolvedValue(identity);
  m.ip.mockReturnValue({ success: true });
  m.quota.mockReturnValue({ success: true });
  m.application.mockResolvedValue({ status: 'ROLEPLAY_IN_PROGRESS' });
  m.recover.mockResolvedValue({ state: 'pending' });
  m.authorize.mockResolvedValue({ path, token: 'test-token' });
  m.confirm.mockResolvedValue('created');
  m.discard.mockResolvedValue('pending');
});
afterEach(() => vi.unstubAllEnvs());

describe('private bilingual opening API', () => {
  it('is disabled without an explicit rollout flag, before authentication or storage', async () => {
    vi.stubEnv('ROLEPLAY_BILINGUAL_OPENING_API_ENABLED', '');
    expect((await GET(request(), params)).status).toBe(404);
    expect((await POST(request({ action: 'confirm', path }), params)).status).toBe(404);
    expect(m.identity).not.toHaveBeenCalled();
    expect(m.confirm).not.toHaveBeenCalled();
  });

  it('recovers only the state, with private no-store headers', async () => {
    const response = await GET(request(), params);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ success: true, data: { state: 'pending' } });
    expect(m.recover).toHaveBeenCalledWith(expect.anything(), 'session-1',
      { role: 'candidate', candidateId: 7, sessionCookie: 'session-1' });
  });

  it('authorizes an upload and confirms only a path, never client duration', async () => {
    expect((await POST(request({ action: 'authorize', mimeType: 'audio/webm', size: 100 }), params)).status).toBe(200);
    expect(m.authorize).toHaveBeenCalledOnce();
    expect((await POST(request({ action: 'confirm', path, durationSec: 42 }), params)).status).toBe(400);
    expect(m.confirm).not.toHaveBeenCalled();
    expect((await POST(request({ action: 'confirm', path }), params)).status).toBe(200);
    expect(m.confirm).toHaveBeenCalledWith(expect.anything(), 'session-1',
      { role: 'candidate', candidateId: 7, sessionCookie: 'session-1' }, path);
  });

  it('rejects mismatched identity, cookies, and ineligible recruitment applications', async () => {
    m.bearer.mockResolvedValue({ ...identity, userId: 'other' });
    expect((await GET(request(undefined, { authorization: 'Bearer wrong' }), params)).status).toBe(403);
    expect((await GET(request(undefined, { cookie: 'roleplay_session=other' }), params)).status).toBe(403);
    m.application.mockResolvedValue({ status: 'REJECTED' });
    expect((await GET(request(), params)).status).toBe(403);
    expect(m.recover).not.toHaveBeenCalled();
  });

  it('enforces quotas and rejects oversized or cross-site requests', async () => {
    m.quota.mockReturnValueOnce({ success: false });
    expect((await POST(request({ action: 'confirm', path }), params)).status).toBe(429);
    expect((await POST(request({ action: 'confirm', path: 'x'.repeat(3000) }), params)).status).toBe(400);
    expect((await POST(request({ action: 'confirm', path }, { 'sec-fetch-site': 'cross-site' }), params)).status).toBe(403);
    expect(m.confirm).not.toHaveBeenCalled();
  });

  it('returns a conflict without leaking private paths or provider errors', async () => {
    m.confirm.mockRejectedValueOnce(new BilingualOpeningStoreError('CONFLICT'));
    expect((await POST(request({ action: 'confirm', path }), params)).status).toBe(409);
    m.confirm.mockRejectedValueOnce(new Error('private storage token'));
    const response = await POST(request({ action: 'confirm', path }), params);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private storage token');
  });
});

it('discards only through the authorized command without confirming audio', async () => {
  const response = await POST(request({ action: 'discard', path }), params);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true, data: { state: 'pending' } });
  expect(m.discard).toHaveBeenCalledWith(expect.anything(), 'session-1',
    { role: 'candidate', candidateId: 7, sessionCookie: 'session-1' }, path);
  expect(m.confirm).not.toHaveBeenCalled();
  expect((await POST(request({ action: 'discard', path }, { cookie: 'roleplay_session=other' }), params)).status).toBe(403);
  expect(m.discard).toHaveBeenCalledTimes(1);
});
