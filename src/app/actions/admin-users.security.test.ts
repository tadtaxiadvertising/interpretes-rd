// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  deleteAuthUser: vi.fn(),
  updateAuthUser: vi.fn(),
  localDelete: vi.fn(),
  localUpdate: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/prisma', () => ({
  default: { userProfile: { delete: mocks.localDelete, update: mocks.localUpdate } },
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
import { deleteUserAccess, updateUserPassword, updateUserProfile } from './admin-users';

describe('admin user access revocation and error privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { role: 'admin' } });
    mocks.deleteAuthUser.mockResolvedValue({ data: {}, error: null });
    mocks.localDelete.mockResolvedValue({ interpreterId: 19 });
    mocks.localUpdate.mockResolvedValue({ interpreterId: 19, displayName: 'Test User', email: 'user@example.test' });
    mocks.updateAuthUser.mockResolvedValue({ data: {}, error: null });
  });

  const updatedProfile = { displayName: 'Test User', email: 'user@example.test' };

  it('reports a fully synchronized profile update only when Supabase acknowledges it', async () => {
    const result = await updateUserProfile('user-123', updatedProfile);
    expect(result).toMatchObject({
      success: true,
      profile: { displayName: 'Test User', email: 'user@example.test' },
    });
    expect(mocks.localUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-123' },
      select: { interpreterId: true, displayName: true, email: true },
    }));
    expect(mocks.updateAuthUser).toHaveBeenCalledWith('user-123', expect.objectContaining({
      email: 'user@example.test',
    }));
    expect(mocks.refresh).toHaveBeenCalledWith(19);
  });

  it('does not report complete profile sync if Supabase returns an error object', async () => {
    mocks.updateAuthUser.mockResolvedValueOnce({
      data: null, error: { message: 'Bearer PRIVATE_SYNC_TOKEN' },
    });
    const logged = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await updateUserProfile('user-123', updatedProfile);
      expect(result).toMatchObject({ success: false, partial: true });
      expect(result.error).toContain('sincronización con Supabase Auth');
      expect(mocks.localUpdate).toHaveBeenCalledTimes(1);
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
      expect(JSON.stringify([result, logged.mock.calls])).not.toContain('PRIVATE_SYNC_TOKEN');
    } finally { logged.mockRestore(); }
  });

  it('preserves a partial outcome if Supabase throws after the local write', async () => {
    mocks.updateAuthUser.mockRejectedValueOnce(new Error('postgresql://svc:PRIVATE_DB_PASS@internal'));
    const logged = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await updateUserProfile('user-123', updatedProfile);
      expect(result).toMatchObject({ success: false, partial: true });
      expect(mocks.localUpdate).toHaveBeenCalledTimes(1);
      expect(JSON.stringify([result, logged.mock.calls])).not.toMatch(/postgresql:|PRIVATE_DB_PASS/);
    } finally { logged.mockRestore(); }
  });

  it('keeps success after provider sync when only cache invalidation fails', async () => {
    mocks.refresh.mockImplementationOnce(() => { throw new Error('PRIVATE_CACHE_TOKEN'); });
    const logged = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await updateUserProfile('user-123', updatedProfile)).toMatchObject({
        success: true,
      });
      expect(mocks.localUpdate).toHaveBeenCalledTimes(1);
      expect(mocks.updateAuthUser).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(logged.mock.calls)).not.toContain('PRIVATE_CACHE_TOKEN');
    } finally { logged.mockRestore(); }
  });

  it('never attempts a provider profile update when the local write fails', async () => {
    mocks.localUpdate.mockRejectedValueOnce(new Error('PRIVATE_LOCAL_DB_TOKEN'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await updateUserProfile('user-123', updatedProfile);
      expect(result.success).toBe(false);
      expect(mocks.updateAuthUser).not.toHaveBeenCalled();
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(JSON.stringify([result, logged.mock.calls])).not.toContain('PRIVATE_LOCAL_DB_TOKEN');
    } finally { logged.mockRestore(); }
  });

  it('never updates a profile for a non-administrator', async () => {
    mocks.auth.mockResolvedValueOnce({ user: { role: 'interpreter' } });
    const result = await updateUserProfile('user-123', updatedProfile);
    expect(result.success).toBe(false);
    expect(mocks.localUpdate).not.toHaveBeenCalled();
    expect(mocks.updateAuthUser).not.toHaveBeenCalled();
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
