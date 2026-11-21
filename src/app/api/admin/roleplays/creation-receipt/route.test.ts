// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  validate: vi.fn(),
  bearer: vi.fn(),
  receipt: vi.fn(),
}));
vi.mock('@/lib/auth/actions', () => ({ validateAction: mocks.validate }));
vi.mock('@/lib/api-auth', () => ({ actorFromBearer: mocks.bearer }));
vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/roleplay/creation-receipt', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/roleplay/creation-receipt')>();
  return { ...original, lookupRoleplayCreationReceipt: mocks.receipt };
});

import { POST } from './route';

const url = 'http://localhost/api/admin/roleplays/creation-receipt';
const key = '123e4567-e89b-42d3-a456-426614174000';
const body = JSON.stringify({ requestKey: key });

function request(payload = body, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: 'POST',
    body: payload,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('POST /api/admin/roleplays/creation-receipt (disabled-by-default)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED', 'true');
    mocks.validate.mockResolvedValue({ user: { userId: 'admin-cookie-A', role: 'admin' } });
    mocks.receipt.mockResolvedValue({ status: 'IN_PROGRESS' });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('does not touch auth or DB when the feature flag is absent/off', async () => {
    vi.stubEnv('ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED', '');
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.validate).not.toHaveBeenCalled();
    expect(mocks.receipt).not.toHaveBeenCalled();
  });

  it('requires an administrator before reading the request body or ledger', async () => {
    mocks.validate.mockResolvedValueOnce({ error: 'Forbidden' });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(mocks.receipt).not.toHaveBeenCalled();
  });

  it.each([
    ['different admin', { role: 'admin', userId: 'admin-other' }],
    ['interpreter bearer', { role: 'interpreter', userId: 'admin-cookie-A' }],
    ['invalid bearer', null],
  ])('rejects %s even if privileged cookie is present', async (_label, bearer) => {
    mocks.bearer.mockResolvedValueOnce(bearer);
    const response = await POST(request(body, { Authorization: 'Bearer explicit' }));
    expect(response.status).toBe(403);
    expect(mocks.receipt).not.toHaveBeenCalled();
  });

  it('uses exactly the matching authenticated admin identity', async () => {
    mocks.bearer.mockResolvedValueOnce({ role: 'admin', userId: 'admin-cookie-A' });
    const response = await POST(request(body, { Authorization: 'Bearer valid' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { status: 'IN_PROGRESS' } });
    expect(mocks.receipt).toHaveBeenCalledWith(expect.anything(), 'admin-cookie-A', key);
    expect(response.headers.get('Vary')).toBe('Cookie, Authorization');
  });

  it('rejects malformed request keys and extra fields without reading the ledger', async () => {
    for (const payload of [
      '{"requestKey":"../../secret"}',
      '{"requestKey":"123e4567-e89b-42d3-a456-426614174000","actorUserId":"other"}',
      '{"requestKey":3}',
      '{not-json',
    ]) {
      const response = await POST(request(payload));
      expect(response.status).toBe(400);
    }
    expect(mocks.receipt).not.toHaveBeenCalled();
  });

  it('rejects non-JSON requests without reading the ledger', async () => {
    const response = await POST(request(body, { 'Content-Type': 'text/plain' }));
    expect(response.status).toBe(415);
    expect(mocks.receipt).not.toHaveBeenCalled();
  });

  it('rejects oversized request bodies without trusting Content-Length', async () => {
    const huge = JSON.stringify({ requestKey: key, extra: 'x'.repeat(2000) });
    const response = await POST(request(huge));
    expect(response.status).toBe(413);
    expect(mocks.receipt).not.toHaveBeenCalled();
    const declared = await POST(request(body, { 'Content-Length': '3000' }));
    expect(declared.status).toBe(413);
  });

  it('exposes only the admin-owned completed result, never invitations or audio links', async () => {
    mocks.receipt.mockResolvedValueOnce({
      status: 'COMPLETED', sessionIds: ['session-1'], createdCount: 1,
      skippedCount: 0, scenarioCount: 25,
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('session-1');
    expect(text).not.toMatch(/inviteCode|tokenHash|signedUrl|baseAudioUrl|emailCorporativo/);
  });

  it('does not report success when the private ledger table is unavailable', async () => {
    mocks.receipt.mockRejectedValueOnce(new Error('PRIVATE_POSTGRES_URL_TOKEN'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await POST(request());
      expect(response.status).toBe(503);
      expect((await response.json()).success).toBe(false);
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_POSTGRES_URL_TOKEN');
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    } finally {
      log.mockRestore();
    }
  });
});
