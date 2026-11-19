// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  transaction: vi.fn(),
  deleteRecords: vi.fn(),
  adminAuth: vi.fn(),
  deleteUser: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/actions', () => ({ validateAction: m.auth }));
vi.mock('@/lib/prisma', () => ({ default: { $transaction: m.transaction } }));
vi.mock('@/lib/cache/revalidate-interpreter', () => ({
  revalidateInterpreterProfileRecords: m.revalidate,
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { get auth() { return m.adminAuth(); } },
  ADMIN_UNAVAILABLE_MESSAGE: 'Auth admin unavailable',
  isAdminUnavailableError: (error: unknown) =>
    error instanceof Error && error.name === 'SupabaseAdminUnavailableError',
  getSupabaseServiceRoleKey: vi.fn(),
}));
vi.mock('@/lib/supabase/auth-users', () => ({
  upsertConfirmedAuthUser: vi.fn(),
  findAuthUserByEmail: vi.fn(),
}));
vi.mock('@/lib/interpreters/delete-interpreter', () => ({
  deleteInterpreterDatabaseRecords: m.deleteRecords,
  InterpreterNotFoundError: class InterpreterNotFoundError extends Error {},
  InterpreterHasHistoricalRecordsError: class InterpreterHasHistoricalRecordsError extends Error {},
}));

import { deleteInterpreter } from './interpreters';

describe('interpreter deletion: PostgreSQL commit and external Auth status', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.auth.mockResolvedValue({ profile: { role: 'admin' }, user: { userId: 'fictional-admin' } });
    m.adminAuth.mockReturnValue({ admin: { deleteUser: m.deleteUser } });
    m.deleteUser.mockResolvedValue({ error: null });
    m.deleteRecords.mockResolvedValue({ authUserId: 'fictional-linked-auth-id' });
    m.transaction.mockImplementation(async (callback) => callback({}));
  });

  it('deletes Auth after committing local records and returns success only on confirmation', async () => {
    expect(await deleteInterpreter(23)).toEqual({ success: true });
    expect(m.transaction).toHaveBeenCalledOnce();
    expect(m.deleteRecords).toHaveBeenCalledWith({}, 23);
    expect(m.deleteUser).toHaveBeenCalledWith('fictional-linked-auth-id');
    expect(m.revalidate).toHaveBeenCalledWith(23);
    expect(m.deleteRecords.mock.invocationCallOrder[0])
      .toBeLessThan(m.deleteUser.mock.invocationCallOrder[0]);
  });

  it('does not call Supabase when the deleted record had no linked Auth account', async () => {
    m.deleteRecords.mockResolvedValueOnce({ authUserId: null });
    expect(await deleteInterpreter(23)).toEqual({ success: true });
    expect(m.deleteUser).not.toHaveBeenCalled();
  });

  it('reports partial failure instead of success when Supabase returns an error', async () => {
    const err = new Error('postgresql://PRIVATE_AUTH_PASSWORD@internal.invalid');
    err.name = 'Bearer PRIVATE_TOKEN';
    m.deleteUser.mockResolvedValueOnce({ error: err });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await deleteInterpreter(23);
      expect(result).toMatchObject({ success: false, code: 'PARTIAL_FAILURE' });
      expect(result.error).toContain('No repitas la baja');
      expect(m.transaction).toHaveBeenCalledOnce();
      expect(m.deleteUser).toHaveBeenCalledOnce();
      expect(m.revalidate).not.toHaveBeenCalled();
      expect(JSON.stringify([result, warn.mock.calls])).not.toMatch(/PRIVATE_|postgresql:|internal\.invalid/);
      expect(warn).toHaveBeenCalledWith('[DELETE_INTERPRETER] Auth revocation not confirmed:', 'Error');
    } finally {
      warn.mockRestore();
    }
  });

  it('reports uncertain partial failure when the Auth API throws', async () => {
    m.deleteUser.mockRejectedValueOnce(new Error('SECRET_PROVIDER_RESPONSE'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await deleteInterpreter(23);
      expect(result).toMatchObject({ success: false, code: 'PARTIAL_FAILURE' });
      expect(result.error).toContain('revisión administrativa');
      expect(JSON.stringify([result, warn.mock.calls])).not.toContain('SECRET_PROVIDER_RESPONSE');
      expect(m.transaction).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });

  it('does not falsely report a completed deletion as failed when cache refresh throws', async () => {
    m.revalidate.mockImplementationOnce(() => { throw new Error('PRIVATE_CACHE_TOKEN'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await deleteInterpreter(23)).toEqual({ success: true });
      expect(m.deleteUser).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith('[DELETE_INTERPRETER] Post-delete cache refresh failed:', 'Error');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_CACHE_TOKEN');
    } finally {
      warn.mockRestore();
    }
  });

  it('refuses all deletes if the Auth client cannot initialize', async () => {
    m.adminAuth.mockImplementationOnce(() => {
      throw new Error('PRIVATE_PROVIDER_KEY');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await deleteInterpreter(23);
      expect(result).toMatchObject({ success: false, code: 'SERVICE_UNAVAILABLE' });
      expect(result.error).toContain('No se eliminaron registros');
      expect(m.transaction).not.toHaveBeenCalled();
      expect(m.deleteRecords).not.toHaveBeenCalled();
      expect(m.deleteUser).not.toHaveBeenCalled();
      expect(JSON.stringify([result, warn.mock.calls])).not.toContain('PRIVATE_PROVIDER_KEY');
    } finally {
      warn.mockRestore();
    }
  });

  it('refuses deletion for an interpreter with historical records', async () => {
    const { InterpreterHasHistoricalRecordsError } = await import('@/lib/interpreters/delete-interpreter');
    m.transaction.mockRejectedValueOnce(new InterpreterHasHistoricalRecordsError());
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await deleteInterpreter(23);
      expect(result).toMatchObject({ success: false, code: 'CONFLICT' });
      expect(result.error).toContain('registros históricos');
      expect(m.deleteUser).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('does not mistake a provider error with not-found text for a missing interpreter', async () => {
    m.transaction.mockRejectedValueOnce(new Error('Intérprete no encontrado'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await deleteInterpreter(23);
      expect(result).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
      expect(m.deleteUser).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('returns a safe typed not-found outcome without retrying Auth', async () => {
    const { InterpreterNotFoundError } = await import('@/lib/interpreters/delete-interpreter');
    m.transaction.mockRejectedValueOnce(new InterpreterNotFoundError());
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await deleteInterpreter(23);
      expect(result).toMatchObject({ success: false, code: 'NOT_FOUND' });
      expect(result.error).toContain('Verifica el acceso de Auth');
      expect(m.deleteUser).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('does not leak database error messages or error objects to UI/logs', async () => {
    const err = new Error('postgresql://PRIVATE_DB_PASSWORD@db.invalid');
    err.name = 'Bearer PRIVATE_DB_TOKEN';
    m.transaction.mockRejectedValueOnce(err);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await deleteInterpreter(23);
      expect(result).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
      expect(JSON.stringify([result, log.mock.calls])).not.toMatch(/PRIVATE_|postgresql:|db\.invalid/);
      expect(log).toHaveBeenCalledWith('[DELETE_INTERPRETER] Failed before completion:', 'Error');
    } finally {
      log.mockRestore();
    }
  });

  it('denies a non-admin request before any Auth or database call', async () => {
    m.auth.mockResolvedValueOnce({ error: 'Forbidden', code: 'UNAUTHORIZED' });
    expect(await deleteInterpreter(23)).toMatchObject({ success: false, code: 'UNAUTHORIZED' });
    expect(m.adminAuth).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.deleteUser).not.toHaveBeenCalled();
  });
});
