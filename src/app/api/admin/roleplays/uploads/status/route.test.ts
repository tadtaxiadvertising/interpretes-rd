// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  findUnique: vi.fn(), actor: vi.fn(), ip: vi.fn(), quota: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  default: { roleplayUploadReservation: { findUnique: m.findUnique } },
}));
vi.mock('@/lib/roleplay/creation-actor', () => ({ resolveRoleplayCreationActor: m.actor }));
vi.mock('@/lib/security/rate-limit', () => ({
  applyRateLimit: m.ip, rateLimit: m.quota, createRateLimitHeaders: () => ({ 'Retry-After': '60' }),
}));

import { POST } from './route';
import { prepareRoleplayDirectUploadBatch } from '@/lib/roleplay/direct-upload-contract';
import { fingerprintRoleplayDirectUploadDeclarations } from '@/lib/roleplay/direct-upload-reservation-fingerprint';
const key = '123e4567-e89b-42d3-a456-426614174000';
const batchId = '823e4567-e89b-42d3-a456-426614174001';
const now = new Date('2026-11-28T03:00:00Z').getTime();
const items = prepareRoleplayDirectUploadBatch(batchId, [0, 1].map(order => ({
  order, mime: 'audio/mpeg', sizeBytes: 16, sha256: 'a'.repeat(64),
}))).items;
function ledger(status: string, expired: boolean) {
  const expiresAt = new Date(now + (expired ? -60_000 : 60_000));
  const createdAt = new Date(expiresAt.getTime() - 30 * 60_000);
  return {
    id: batchId, status, createdAt, expiresAt, items,
    declarationHash: fingerprintRoleplayDirectUploadDeclarations(items),
    verifiedObjects: items.slice(0, status === 'VERIFIED' ? 2 : 1).map(({ order, path, sizeBytes, sha256 }) =>
      ({ order, path, sizeBytes, sha256, verifiedAtMs: createdAt.getTime() + 1000 })),
    token: 'private-token',
  };
}
const statusSelect = { status: true, expiresAt: true, createdAt: true, id: true,
  declarationHash: true, items: true, verifiedObjects: true };
function request(payload: unknown = { requestKey: key }, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/admin/roleplays/uploads/status', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
}
const call = (req = request()) => POST(req as never);

describe('direct reservation ledger status API', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('ROLEPLAY_DIRECT_UPLOAD_RESERVATION_API_ENABLED', 'true');
    m.actor.mockResolvedValue('admin-a');
    m.ip.mockReturnValue({ success: true });
    m.quota.mockReturnValue({ success: true });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

  it.each([
    ['RESERVED', false, 'RESERVED'], ['VERIFIED', false, 'VERIFIED'],
    ['RESERVED', true, 'EXPIRED'], ['VERIFIED', true, 'EXPIRED'],
    ['PUBLISHED', true, 'PUBLICATION_RECORDED'], ['CANCELLED', true, 'CANCELLED'],
    ['UNKNOWN', false, 'REVIEW_REQUIRED'],
  ] as const)('projects only the recorded state (%s, expired=%s)', async (status, expired, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const row = ledger(status, expired);
    m.findUnique.mockResolvedValue(row);
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toContain('Authorization');
    const progress = status === 'RESERVED' || status === 'VERIFIED'
      ? { total: 2, recordedVerifiedCount: status === 'VERIFIED' ? 2 : 1,
          expiresAt: row.expiresAt.toISOString(), observedAt: new Date(now).toISOString() }
      : undefined;
    expect(await res.json()).toEqual({ success: true, data: { status: expected, ...(progress ? { progress } : {}) } });
    expect(m.findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { actorUserId_requestKey: { actorUserId: 'admin-a', requestKey: key } },
      select: statusSelect,
    });
  });

  it.each(['wrong-count', 'wrong-digest', 'wrong-order', 'invalid-expiry', 'invalid-evidence'] as const)(
    'does not report progress for an inconsistent ledger (%s)', async kind => {
      vi.useFakeTimers();
      vi.setSystemTime(now);
      const row = ledger('RESERVED', false);
      if (kind === 'wrong-count') row.status = 'VERIFIED';
      if (kind === 'wrong-digest') row.declarationHash = 'b'.repeat(64);
      if (kind === 'wrong-order') row.verifiedObjects[0].order = 1;
      if (kind === 'invalid-expiry') row.expiresAt = new Date(NaN);
      if (kind === 'invalid-evidence') row.verifiedObjects[0].verifiedAtMs = row.expiresAt.getTime();
      m.findUnique.mockResolvedValue(row);
      const res = await call();
      expect(await res.json()).toEqual({ success: true, data: { status: 'REVIEW_REQUIRED' } });
    },
  );

  it('returns NOT_FOUND for an absent actor-scoped row, never a global lookup', async () => {
    m.actor.mockResolvedValue('admin-b');
    m.findUnique.mockResolvedValue(null);
    const res = await call();
    expect(await res.json()).toEqual({ success: true, data: { status: 'NOT_FOUND' } });
    expect(m.findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { actorUserId_requestKey: { actorUserId: 'admin-b', requestKey: key } },
      select: statusSelect,
    });
  });

  it.each([{ requestKey: 'invalid' }, { requestKey: key, actorUserId: 'other' }, { requestKey: 'a'.repeat(1024) }])(
    'rejects invalid or oversized input before a database lookup', async payload => {
      expect((await call(request(payload))).status).toBe(400);
      expect(m.findUnique).not.toHaveBeenCalled();
    },
  );

  it('rejects disabled, cross-site, unauthenticated and rate-limited requests', async () => {
    vi.stubEnv('ROLEPLAY_DIRECT_UPLOAD_RESERVATION_API_ENABLED', 'false');
    expect((await call()).status).toBe(404);
    vi.stubEnv('ROLEPLAY_DIRECT_UPLOAD_RESERVATION_API_ENABLED', 'true');
    expect((await call(request({ requestKey: key }, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    m.actor.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(403);
    m.quota.mockReturnValueOnce({ success: false });
    expect((await call()).status).toBe(429);
    expect(m.findUnique).not.toHaveBeenCalled();
  });

  it('does not wait for stalled request bodies or their cancellation', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const req = new Request('http://localhost/api/admin/roleplays/uploads/status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: new ReadableStream<Uint8Array>({ cancel }), duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    const pending = call(req);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await pending).status).toBe(400);
    expect(cancel).toHaveBeenCalledOnce();
    expect(m.findUnique).not.toHaveBeenCalled();
  });

  it('redacts database exceptions', async () => {
    m.findUnique.mockRejectedValue(new Error('PRIVATE_DATABASE_URL'));
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('PRIVATE_DATABASE_URL');
  });
});
