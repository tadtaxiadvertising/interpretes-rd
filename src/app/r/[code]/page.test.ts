import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({
  redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT'); }),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
}));

vi.mock('next/navigation', () => ({
  redirect: navigation.redirect,
  notFound: navigation.notFound,
}));

import ShortInviteRedirect, { metadata } from './page';

describe('public short roleplay invitation link', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['ABCD1234', 'aB_c-123', 'abc123'])(
    'redirects syntactically valid codes without looking up invitation state (%s)',
    async (code) => {
      await expect(ShortInviteRedirect({ params: Promise.resolve({ code }) }))
        .rejects.toThrow('NEXT_REDIRECT');
      expect(navigation.redirect).toHaveBeenCalledExactlyOnceWith(
        `/roleplays/invite-by-code/${code.toUpperCase()}`,
      );
      expect(navigation.notFound).not.toHaveBeenCalled();
    },
  );

  it.each(['', '../admin', 'abc%2Fadmin', 'a.b', 'A'.repeat(65)])(
    'rejects invalid input without a database lookup (%s)',
    async (code) => {
      await expect(ShortInviteRedirect({ params: Promise.resolve({ code }) }))
        .rejects.toThrow('NEXT_NOT_FOUND');
      expect(navigation.notFound).toHaveBeenCalledTimes(1);
      expect(navigation.redirect).not.toHaveBeenCalled();
    },
  );

  it('prevents search engines from indexing invitation URLs', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
