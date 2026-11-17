import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ actorFromBearer: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ actorFromBearer: mocks.actorFromBearer }));

import { matchesExplicitAdminBearer } from './happyscribe-admin-identity';

function request(authorization?: string) {
  return new Request('https://interpretes.example/api/admin/happyscribe/media', {
    headers: authorization === undefined ? {} : { Authorization: authorization },
  });
}

describe('HappyScribe cookie-bound admin identity', () => {
  beforeEach(() => mocks.actorFromBearer.mockReset());

  it('allows existing cookie-only requests without resolving a Bearer actor', async () => {
    expect(await matchesExplicitAdminBearer(request(), 'admin-1')).toBe(true);
    expect(mocks.actorFromBearer).not.toHaveBeenCalled();
  });

  it('rejects malformed or invalid explicit authorization', async () => {
    mocks.actorFromBearer.mockResolvedValue(null);
    expect(await matchesExplicitAdminBearer(request('Basic invalid'), 'admin-1')).toBe(false);
    expect(mocks.actorFromBearer).toHaveBeenCalledOnce();
  });

  it('rejects an interpreter Bearer even with an admin cookie', async () => {
    mocks.actorFromBearer.mockResolvedValue({ userId: 'interpreter-1', role: 'interpreter' });
    expect(await matchesExplicitAdminBearer(request('Bearer interpreter-token'), 'admin-1')).toBe(false);
  });

  it('rejects a Bearer belonging to a different administrator', async () => {
    mocks.actorFromBearer.mockResolvedValue({ userId: 'admin-2', role: 'admin' });
    expect(await matchesExplicitAdminBearer(request('Bearer second-admin-token'), 'admin-1')).toBe(false);
  });

  it('permits an independently verified Bearer for the same administrator', async () => {
    mocks.actorFromBearer.mockResolvedValue({ userId: 'admin-1', role: 'admin' });
    expect(await matchesExplicitAdminBearer(request('Bearer matching-admin-token'), 'admin-1')).toBe(true);
  });

  it('fails closed when Bearer identity resolution throws', async () => {
    // Simulate an exception without introducing a dangling rejected promise
    // into the test runner's module-mocking lifecycle.
    mocks.actorFromBearer.mockImplementationOnce(() => {
      throw new Error('Sensitive provider detail');
    });
    await expect(matchesExplicitAdminBearer(request('Bearer broken-token'), 'admin-1'))
      .resolves.toBe(false);
    expect(mocks.actorFromBearer).toHaveBeenCalledOnce();
  });
});
