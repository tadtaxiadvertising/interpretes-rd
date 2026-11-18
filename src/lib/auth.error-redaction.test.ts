// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  nextAuth: vi.fn(),
  findProfile: vi.fn(),
  resolveRole: vi.fn(),
}));
vi.mock('./supabase/server', () => ({
  createClient: mocks.createClient,
  isSupabaseConfigError: () => false,
}));
vi.mock('./prisma', () => ({
  default: { userProfile: { findUnique: mocks.findProfile } },
}));
vi.mock('./auth-rbac', () => ({ auth: mocks.nextAuth }));
vi.mock('./admin-identity', () => ({ resolveUserRoleByEmail: mocks.resolveRole }));
import { auth } from './auth';

describe('authentication bridge keeps provider diagnostics private', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });
    mocks.nextAuth.mockResolvedValue(null);
    mocks.resolveRole.mockReturnValue('interpreter');
  });

  it('redacts both Supabase and NextAuth errors while preserving failure handling', async () => {
    mocks.createClient.mockRejectedValueOnce(
      new Error('postgresql://user:PRIVATE_DB_SECRET@db.internal/auth'),
    );
    mocks.nextAuth.mockRejectedValueOnce(
      new Error('Bearer PRIVATE_SESSION_TOKEN'),
    );
    const logged = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await auth()).toEqual({ userId: null, user: null });
      expect(logged).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(logged.mock.calls)).not.toMatch(
        /PRIVATE_DB_SECRET|PRIVATE_SESSION_TOKEN|postgresql:|Bearer /,
      );
      expect(logged.mock.calls[0]).toContain('Error');
      expect(logged.mock.calls[1]).toContain('Error');
    } finally {
      logged.mockRestore();
    }
  });

  it('still falls back to a valid legacy session after a Supabase connection failure', async () => {
    mocks.createClient.mockRejectedValueOnce(new Error('PRIVATE_SUPABASE_TOKEN'));
    mocks.nextAuth.mockResolvedValueOnce({
      user: { id: 'legacy-101', email: 'interpreter@example.test', name: 'Test Interpreter', role: 'interpreter' },
    });
    const logged = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await auth();
      expect(result.userId).toBe('legacy-101');
      expect(result.user.role).toBe('interpreter');
      expect(mocks.resolveRole).toHaveBeenCalled();
      expect(JSON.stringify(logged.mock.calls)).not.toContain('PRIVATE_SUPABASE_TOKEN');
    } finally {
      logged.mockRestore();
    }
  });
});
