// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  deleteAuthUser: vi.fn(),
  updateAuthUser: vi.fn(),
  localDelete: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/prisma', () => ({
  default: { userProfile: { delete: mocks.localDelete } },
}));
vi.mock('@/lib/cache/revalidate-interpreter', () => ({
  revalidateInterpreterProfileRecords: mocks.refresh,
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    auth: { admin: {
      deleteUser: mocks.deleteAuthUser,
      updateUserById: mocks.updateAuthUser,
    } },
  },
  ADMIN_UNAVAILABLE_MESSAGE: 'Admin unavailable',
  isAdminUnavailableError: (value: unknown) =>
    value instanceof Error && value.name === 'SupabaseAdminUnavailableError',
}));
import { deleteUserAccess, updateUserPassword } from './admin-users';

describe('admin user access revocation and error privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { role: 'admin' } });
    mocks.deleteAuthUser.mockResolvedValue({ data: {}, error: null });
    mocks.localDelete.mockResolvedValue({ interpreterId: 19 });
    mocks.updateAuthUser.mockResolvedValue({ data: {}, error: null });
  });

  it('revokes provider access before removing the local profile', async () => {
    const callOrder: string[] = [];
    mocks.deleteAuthUser.mockImplementationOnce(async () => {
      callOrder.push('auth');
      return { data: {}, error: null };
    });
    mocks.localDelete.mockImplementationOnce(async () => {
      callOrder.push('local');
      return { interpreterId: 19 };
    });
    expect(await deleteUserAccess('user-123')).toEqual({ success: true });
    expect(callOrder).toEqual(['auth', 'local']);
    expect(mocks.deleteAuthUser).toHaveBeenCalledWith('user-123');
    expect(mocks.localDelete).toHaveBeenCalledWith({
      where: { id: 'user-123' },
      select: { interpreterId: true },
    });
    expect(mocks.refresh).toHaveBeenCalledWith(19);
  });

  it('never deletes the local profile when Supabase returns an auth error object', async () => {
    mocks.deleteAuthUser.mockResolvedValueOnce({
      data: null,
      error: { message: 'PRIVATE_SERVICE_TOKEN postgresql://svc:pw@internal' },
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const outcome = await deleteUserAccess('user-123');
      expect(outcome).toMatchObject({ success: false });
      expect(outcome.error).toContain('No se pudo revocar');
      expect(mocks.localDelete).not.toHaveBeenCalled();
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(JSON.stringify([outcome, logged.mock.calls])).not.toMatch(/PRIVATE_SERVICE_TOKEN|postgresql:|internal/);
    } finally { logged.mockRestore(); }
  });

  it('never deletes the local profile when Supabase throws a credential-bearing error', async () => {
    mocks.deleteAuthUser.mockRejectedValueOnce(new Error('Bearer PRIVATE_AUTH_TOKEN'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const outcome = await deleteUserAccess('user-123');
      expect(outcome.success).toBe(false);
      expect(mocks.localDelete).not.toHaveBeenCalled();
      expect(JSON.stringify([outcome, logged.mock.calls])).not.toContain('PRIVATE_AUTH_TOKEN');
    } finally { logged.mockRestore(); }
  });

  it('reports missing admin-service configuration without deleting a local profile', async () => {
    const error = new Error('Admin unavailable');
    error.name = 'SupabaseAdminUnavailableError';
    mocks.deleteAuthUser.mockRejectedValueOnce(error);
    expect(await deleteUserAccess('user-123')).toEqual({
      success: false, error: 'Admin unavailable',
    });
    expect(mocks.localDelete).not.toHaveBeenCalled();
  });

  it('reports a partial outcome only after the provider account was revoked', async () => {
    mocks.localDelete.mockRejectedValueOnce(new Error('PRIVATE_DB_PASSWORD'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await deleteUserAccess('user-123');
      expect(result).toMatchObject({ success: false, partial: true });
      expect(result.error).toContain('limpieza del perfil local');
      expect(mocks.deleteAuthUser).toHaveBeenCalledTimes(1);
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(JSON.stringify([result, logged.mock.calls])).not.toContain('PRIVATE_DB_PASSWORD');
    } finally { logged.mockRestore(); }
  });

  it('reports success after both deletions commit even if the cache cannot refresh', async () => {
    mocks.refresh.mockImplementationOnce(() => { throw new Error('PRIVATE_CACHE_KEY'); });
    const logged = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await deleteUserAccess('user-123')).toEqual({ success: true });
      expect(mocks.deleteAuthUser).toHaveBeenCalledTimes(1);
      expect(mocks.localDelete).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(logged.mock.calls)).not.toContain('PRIVATE_CACHE_KEY');
    } finally { logged.mockRestore(); }
  });

  it('does not query either provider for non-admin callers', async () => {
    mocks.auth.mockResolvedValueOnce({ user: { role: 'interpreter' } });
    expect((await deleteUserAccess('user-123')).success).toBe(false);
    expect(mocks.deleteAuthUser).not.toHaveBeenCalled();
    expect(mocks.localDelete).not.toHaveBeenCalled();
  });

  it('redacts provider errors from password-reset failures', async () => {
    mocks.updateAuthUser.mockResolvedValueOnce({
      data: null, error: { message: 'Bearer PRIVATE_RESET_TOKEN' },
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const outcome = await updateUserPassword('user-123', 'nonloggedpassword');
      expect(outcome).toEqual({ success: false, error: 'No se pudo actualizar la contraseña.' });
      expect(JSON.stringify([outcome, logged.mock.calls])).not.toContain('PRIVATE_RESET_TOKEN');
    } finally { logged.mockRestore(); }
  });

  it('does not reveal thrown password-reset error messages to clients or logs', async () => {
    mocks.updateAuthUser.mockRejectedValueOnce(new Error('postgresql://svc:PRIVATE_PASSWORD@db'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const outcome = await updateUserPassword('user-123', 'nonloggedpassword');
      expect(outcome.success).toBe(false);
      expect(JSON.stringify([outcome, logged.mock.calls])).not.toMatch(/PRIVATE_PASSWORD|postgresql:/);
    } finally { logged.mockRestore(); }
  });
});
