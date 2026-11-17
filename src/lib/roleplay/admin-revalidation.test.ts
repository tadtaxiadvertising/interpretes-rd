import { afterEach, describe, expect, it, vi } from 'vitest';
import { revalidateCommittedRoleplayViews } from './admin-revalidation';

afterEach(() => vi.restoreAllMocks());

describe('Roleplay post-commit cache invalidation', () => {
  it('refreshes both admin routes after a successful assignment', () => {
    const revalidate = vi.fn();
    revalidateCommittedRoleplayViews(revalidate);
    expect(revalidate).toHaveBeenCalledTimes(2);
    expect(revalidate.mock.calls.map(([path]) => path)).toEqual([
      '/admin/roleplays',
      '/admin/roleplays/new',
    ]);
  });

  it('does not convert a committed assignment into an error if the first refresh fails', () => {
    const revalidate = vi.fn()
      .mockImplementationOnce(() => { throw new Error('internal-cache-secret'); });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => revalidateCommittedRoleplayViews(revalidate)).not.toThrow();
    expect(revalidate).toHaveBeenCalledTimes(2);
    expect(revalidate).toHaveBeenNthCalledWith(2, '/admin/roleplays/new');
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('Committed roleplay: admin cache refresh failed');
    expect(JSON.stringify(log.mock.calls)).not.toContain('internal-cache-secret');
  });

  it('never throws even when both cache refreshes fail', () => {
    const revalidate = vi.fn(() => { throw new Error('cache unavailable'); });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => revalidateCommittedRoleplayViews(revalidate)).not.toThrow();
    expect(revalidate).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith('Committed roleplay: admin cache refresh failed');
  });
});
