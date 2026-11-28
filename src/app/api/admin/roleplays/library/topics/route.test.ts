import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), bearer: vi.fn(), source: vi.fn(), archive: vi.fn(),
  raw: vi.fn(), execute: vi.fn(), refresh: vi.fn(), transaction: vi.fn(),
}));
vi.mock('@/lib/auth/actions', () => ({ validateAction: mocks.auth }));
vi.mock('@/lib/api-auth', () => ({ actorFromBearer: mocks.bearer }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.refresh }));
vi.mock('@/lib/prisma', () => ({ default: { $transaction: mocks.transaction } }));
vi.mock('@/lib/roleplay-library', () => ({
  getReusableRoleplayAudio: (scenarios: unknown[]) => scenarios.length ? { kind: 'private', paths: ['audio'] } : null,
  getRoleplaySnapshotHash: () => 'a'.repeat(64),
}));
function request(body: unknown = { sessionId: 'session-123', topic: 'medical', subtopic: 'pharmacy' }, headers = {}) {
  return new NextRequest('https://example.test/api/admin/roleplays/library/topics', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('ROLEPLAY_LIBRARY_EDITORIAL_TOPICS_ENABLED', 'true');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.test');
  mocks.auth.mockResolvedValue({ user: { userId: 'admin' } });
  mocks.source.mockResolvedValue({ status: 'INVITED', scenarios: [{}] });
  mocks.archive.mockResolvedValue(null);
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({
    roleplaySession: { findUnique: mocks.source }, roleplayLibraryArchive: { findUnique: mocks.archive },
    $queryRaw: mocks.raw, $executeRaw: mocks.execute,
  }));
  mocks.raw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ topic: 'medical', subtopic: 'pharmacy' }]);
});
afterEach(() => vi.unstubAllEnvs());

describe('initial roleplay catalog topic', () => {
  it('uses the confirmed snapshot fingerprint and never overwrites existing classification', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.source).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'session-123' } }));
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0][0].join(' ')).toContain('ON CONFLICT (fingerprint) DO NOTHING');
    expect(mocks.execute.mock.calls[0].slice(1)).toEqual(['a'.repeat(64), 'medical', 'pharmacy']);
    expect(mocks.refresh).toHaveBeenCalledWith('/admin/roleplays/library');
  });
  it('rejects conflicting existing topic without replacing it', async () => {
    mocks.raw.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([{ topic: 'finance', subtopic: 'banking' }]);
    expect((await POST(request())).status).toBe(409);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('rejects invalid selections and disabled feature before database access', async () => {
    expect((await POST(request({ sessionId: 'session-123', topic: 'medical', subtopic: 'claims' }))).status).toBe(400);
    vi.stubEnv('ROLEPLAY_LIBRARY_EDITORIAL_TOPICS_ENABLED', 'false');
    expect((await POST(request())).status).toBe(503);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('rejects non-admin and mismatched bearer before database access', async () => {
    mocks.auth.mockResolvedValueOnce({ error: 'Forbidden' });
    expect((await POST(request())).status).toBe(403);
    mocks.bearer.mockResolvedValueOnce({ role: 'admin', userId: 'other' });
    expect((await POST(request(undefined, { authorization: 'Bearer test' }))).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('rejects unavailable or archived templates before writing', async () => {
    mocks.source.mockResolvedValueOnce({ status: 'DRAFT', scenarios: [{}] });
    expect((await POST(request())).status).toBe(409);
    mocks.archive.mockResolvedValueOnce({ archivedAt: new Date() });
    expect((await POST(request())).status).toBe(409);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
