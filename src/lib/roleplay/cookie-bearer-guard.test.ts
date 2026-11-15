import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ actorFromBearer: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ actorFromBearer: mocks.actorFromBearer }));

import { verifyRoleplayCookieBearer } from './cookie-bearer-guard';

const cookie = {
  userId: 'candidate-user',
  role: 'candidate' as const,
  candidateId: 5,
  interpreterId: null,
};
const request = (authorization?: string) => new Request('https://example.test/api/roleplay/start', {
  headers: authorization !== undefined ? { Authorization: authorization } : {},
});

describe('verifyRoleplayCookieBearer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actorFromBearer.mockResolvedValue(null);
  });

  it('preserves the existing cookie-only flow', async () => {
    expect(await verifyRoleplayCookieBearer(request(), cookie)).toBe('ok');
    expect(mocks.actorFromBearer).not.toHaveBeenCalled();
  });

  it('does not fall back to cookies for malformed or invalid Authorization', async () => {
    expect(await verifyRoleplayCookieBearer(request('Basic forged'), cookie)).toBe('unauthorized');
    expect(mocks.actorFromBearer).toHaveBeenCalledOnce();
  });

  it.each([
    { userId: 'different-user', role: 'candidate', candidateId: 5, interpreterId: null },
    { userId: 'candidate-user', role: 'interpreter', candidateId: 5, interpreterId: null },
    { userId: 'candidate-user', role: 'candidate', candidateId: 99, interpreterId: null },
  ])('rejects mismatched candidate Bearer ownership: %j', async (bearer) => {
    mocks.actorFromBearer.mockResolvedValue(bearer);
    expect(await verifyRoleplayCookieBearer(request('Bearer test'), cookie)).toBe('forbidden');
  });

  it('requires the same interpreter record for interpreter credentials', async () => {
    mocks.actorFromBearer.mockResolvedValue({
      userId: 'interpreter-user', role: 'interpreter', interpreterId: 30, candidateId: null,
    });
    expect(await verifyRoleplayCookieBearer(request('Bearer test'), {
      userId: 'interpreter-user', role: 'interpreter', interpreterId: 20, candidateId: null,
    })).toBe('forbidden');
  });

  it('permits a matching Bearer only when both identity and role align', async () => {
    mocks.actorFromBearer.mockResolvedValue({
      userId: 'candidate-user', role: 'candidate', candidateId: 5, interpreterId: null,
    });
    expect(await verifyRoleplayCookieBearer(request('Bearer valid'), cookie)).toBe('ok');
  });
});
