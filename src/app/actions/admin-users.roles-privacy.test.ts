// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/prisma', () => ({
  default: { userProfile: { findMany: mocks.findMany, findUnique: mocks.findUnique, update: mocks.update } },
}));
vi.mock('@/lib/cache/revalidate-interpreter', () => ({
  revalidateInterpreterProfileRecords: mocks.refresh,
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { auth: { admin: {} } },
  isAdminUnavailableError: vi.fn(),
  ADMIN_UNAVAILABLE_MESSAGE: 'Admin unavailable',
}));
import { getAdminUsers, updateUserRole } from './admin-users';
import { PROTECTED_ADMIN_EMAILS } from '@/lib/admin-identity';

describe('admin user table minimization and role changes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { role: 'admin', id: 'other-admin' } });
    mocks.findMany.mockResolvedValue([]);
    mocks.findUnique.mockResolvedValue({ email: 'interpreter@example.test' });
    mocks.update.mockResolvedValue({ interpreterId: 19 });
  });

  it('returns browser-safe user fields only, excluding private bank and identity records', async () => {
    expect(await getAdminUsers()).toEqual([]);
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    const args = mocks.findMany.mock.calls[0][0];
    expect(args).toHaveProperty('select.id', true);
    expect(args).toHaveProperty('select.email', true);
    expect(args).toHaveProperty('select.interpreter.select.id', true);
    expect(args).not.toHaveProperty('include');
    expect(JSON.stringify(args)).not.toMatch(/bankName|bankAccount|bankCedula|termsAcceptedAt|signatureDate/);
  });

  it.each(['admin', 'candidate', 'interpreter'] as const)(
    'allows the supported role %s', async role => {
      expect(await updateUserRole('user-2', role)).toEqual({ success: true });
      expect(mocks.update).toHaveBeenCalledWith({
        where: { id: 'user-2' },
        data: { role },
        select: { interpreterId: true },
      });
      expect(mocks.refresh).toHaveBeenCalledWith(19);
    },
  );

  it.each(['manager', 'recruiter', '__proto__', ''] as const)(
    'rejects unsupported server-action role %s without database writes', async role => {
      const result = await updateUserRole('user-2', role as never);
      expect(result.success).toBe(false);
      expect(mocks.findUnique).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it('denies self-demotion by Supabase user ID without modifying the database', async () => {
    mocks.auth.mockResolvedValueOnce({
      userId: 'self-admin',
      user: { id: 'self-admin', role: 'admin', email: 'operator@example.test' },
    });
    const result = await updateUserRole('self-admin', 'interpreter');
    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain('propio acceso');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('denies self-demotion through a legacy Auth.js ID using normalized email', async () => {
    mocks.auth.mockResolvedValueOnce({
      userId: 'legacy-rbac-id',
      user: { id: 'legacy-rbac-id', role: 'admin', email: ' OPERATOR@EXAMPLE.TEST ' },
    });
    mocks.findUnique.mockResolvedValueOnce({ email: 'operator@example.test' });
    const result = await updateUserRole('different-supabase-user-id', 'candidate');
    expect(result).toMatchObject({ success: false });
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: 'different-supabase-user-id' },
      select: { email: true },
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('denies self-demotion when only the auth user ID is available', async () => {
    mocks.auth.mockResolvedValueOnce({
      user: { id: 'self-admin', role: 'admin', email: null },
    });
    const result = await updateUserRole('self-admin', 'candidate');
    expect(result).toMatchObject({ success: false });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('allows an admin to retain their role without blocking a same-role update', async () => {
    mocks.auth.mockResolvedValueOnce({
      userId: 'self-admin',
      user: { id: 'self-admin', role: 'admin', email: 'operator@example.test' },
    });
    mocks.findUnique.mockResolvedValueOnce({ email: 'operator@example.test' });
    expect(await updateUserRole('self-admin', 'admin')).toEqual({ success: true });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'self-admin' },
      data: { role: 'admin' },
      select: { interpreterId: true },
    });
  });

  it('allows authorized role changes to another user with a different email', async () => {
    mocks.auth.mockResolvedValueOnce({
      userId: 'acting-admin',
      user: { id: 'acting-admin', role: 'admin', email: 'operator@example.test' },
    });
    expect(await updateUserRole('different-user', 'candidate')).toEqual({ success: true });
    expect(mocks.update).toHaveBeenCalledOnce();
  });

  it('prevents changing a protected administrator to a lower role', async () => {
    mocks.findUnique.mockResolvedValue({ email: PROTECTED_ADMIN_EMAILS[0] });
    const result = await updateUserRole('user-2', 'candidate');
    expect(result).toMatchObject({ success: false });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('does not report an account role changed if the account no longer exists', async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect((await updateUserRole('missing-user', 'candidate')).success).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('preserves success for a committed role update after a cache failure with redacted logs', async () => {
    mocks.refresh.mockImplementationOnce(() => { throw new Error('Bearer PRIVATE_CACHE_TOKEN'); });
    const logged = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await updateUserRole('user-2', 'candidate')).toEqual({ success: true });
      expect(mocks.update).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(logged.mock.calls)).not.toContain('PRIVATE_CACHE_TOKEN');
    } finally { logged.mockRestore(); }
  });

  it('blocks non-admin callers before any user database read or update', async () => {
    mocks.auth.mockResolvedValue({ user: { role: 'interpreter' } });
    await expect(updateUserRole('user-2', 'admin')).rejects.toThrow('Unauthorized');
    await expect(getAdminUsers()).rejects.toThrow('Unauthorized');
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
