// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: {
    roleplaySession: { findMany: vi.fn() },
    roleplayLibraryArchive: { findMany: vi.fn() },
  },
}));
vi.mock('./RoleplayLibraryVisibilityButton', () => ({
  RoleplayLibraryVisibilityButton: () => null,
}));

import prisma from '@/lib/prisma';
import RoleplayLibraryPage from './page';

describe('Admin roleplay library protects server error logs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://storage.invalid');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('does not serialize sensitive connection errors or signed storage URLs', async () => {
    const secret = 'FAKE_DB_PASSWORD_IN_ERROR';
    const error = new Error('postgresql://private:' + secret + '@db.invalid');
    error.stack = 'https://storage.invalid/audio?token=FAKE_PRIVATE_SIGNATURE';
    vi.mocked(prisma.roleplaySession.findMany).mockRejectedValueOnce(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const page = await RoleplayLibraryPage({ searchParams: Promise.resolve({}) });
    expect(page).toBeTruthy();
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      '[ADMIN ROLEPLAY LIBRARY] Failed to load existing scenario snapshots:', 'Error',
    );
    const serialized = JSON.stringify(log.mock.calls);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('FAKE_PRIVATE_SIGNATURE');
    expect(prisma.roleplayLibraryArchive.findMany).not.toHaveBeenCalled();
  });

  it('also redacts arbitrary non-Error rejection payloads', async () => {
    vi.mocked(prisma.roleplaySession.findMany).mockRejectedValueOnce({
      token: 'FAKE_ARBITRARY_SECRET', message: 'private',
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await RoleplayLibraryPage({ searchParams: Promise.resolve({}) });
    expect(log).toHaveBeenCalledWith(
      '[ADMIN ROLEPLAY LIBRARY] Failed to load existing scenario snapshots:', 'UnknownError',
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('FAKE_ARBITRARY_SECRET');
  });
});
