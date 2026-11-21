// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  transaction: vi.fn(),
  directUpdate: vi.fn(),
  directProfileUpdate: vi.fn(),
  findMany: vi.fn(),
  txInterpreterUpdate: vi.fn(),
  txProfileUpdate: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: mocks.transaction,
    interpreter: { update: mocks.directUpdate, findMany: mocks.findMany },
    userProfile: { updateMany: mocks.directProfileUpdate },
  },
}));
vi.mock('@/lib/auth/actions', () => ({ validateAction: mocks.auth }));
vi.mock('@/lib/cache/revalidate-interpreter', () => ({
  revalidateInterpreterProfileRecords: mocks.revalidate,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/validators', () => ({
  InterpreterSchema: { partial: () => ({ parse: (data: unknown) => data }) },
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {},
  isAdminUnavailableError: () => false,
  getSupabaseServiceRoleKey: () => null,
  ADMIN_UNAVAILABLE_MESSAGE: 'Unavailable',
}));
vi.mock('@/lib/supabase/auth-users', () => ({
  findAuthUserByEmail: vi.fn(),
  upsertConfirmedAuthUser: vi.fn(),
}));
vi.mock('@/lib/interpreters/delete-interpreter', () => ({
  deleteInterpreterDatabaseRecords: vi.fn(),
  InterpreterNotFoundError: class InterpreterNotFoundError extends Error {},
  InterpreterHasHistoricalRecordsError: class InterpreterHasHistoricalRecordsError extends Error {},
  InterpreterLegacyIdentityReviewRequiredError: class InterpreterLegacyIdentityReviewRequiredError extends Error {},
  InterpreterLegacyIdentityCheckUnavailableError: class InterpreterLegacyIdentityCheckUnavailableError extends Error {},
}));

import { getInterpretersForSelect, updateInterpreter } from '../interpreters';

const tx = {
  interpreter: { update: mocks.txInterpreterUpdate },
  userProfile: { updateMany: mocks.txProfileUpdate },
};

describe('administrative interpreter edit: atomicity and private errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { userId: 'test-admin', role: 'admin' } });
    mocks.txInterpreterUpdate.mockResolvedValue({
      id: 42, name: 'Nombre nuevo', emailCorporativo: 'new@example.invalid',
    });
    mocks.txProfileUpdate.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx));
  });

  it('synchronizes Interpreter and UserProfile within the SAME transaction', async () => {
    const result = await updateInterpreter(42, {
      name: 'Nombre nuevo', password: 'FAKE_PASSWORD_SHOULD_NOT_PERSIST',
    } as never);

    expect(result).toMatchObject({ success: true, data: { id: 42, name: 'Nombre nuevo' } });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.txInterpreterUpdate).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { name: 'Nombre nuevo' },
      select: { id: true, name: true, emailCorporativo: true },
    });
    expect(mocks.txProfileUpdate).toHaveBeenCalledWith({
      where: { interpreterId: 42 },
      data: { displayName: 'Nombre nuevo', email: 'new@example.invalid' },
    });
    expect(mocks.directUpdate).not.toHaveBeenCalled();
    expect(mocks.directProfileUpdate).not.toHaveBeenCalled();
    expect(mocks.revalidate).toHaveBeenCalledWith(42);
  });

  it('rejects the entire transaction and logs no private details when profile sync fails', async () => {
    const privateError = new Error('postgres://admin:FAKE_PASSWORD@internal.invalid');
    privateError.stack = 'FAKE_SIGNED_AUDIO_TOKEN';
    mocks.txProfileUpdate.mockRejectedValueOnce(privateError);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await updateInterpreter(42, { name: 'Nombre nuevo' });
      expect(result).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
      expect(mocks.transaction).toHaveBeenCalledOnce();
      expect(mocks.txInterpreterUpdate).toHaveBeenCalledOnce();
      expect(mocks.revalidate).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith('[UPDATE_INTERPRETER] Failed:', 'Error');
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/FAKE_PASSWORD|FAKE_SIGNED_AUDIO_TOKEN|internal\.invalid/);
    } finally {
      log.mockRestore();
    }
  });

  it('returns success after the transaction commits even if cache refresh fails', async () => {
    mocks.revalidate.mockImplementationOnce(() => {
      throw new Error('FAKE_PRIVATE_CACHE_TOKEN');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await updateInterpreter(42, { name: 'Nombre nuevo' });
      expect(result.success).toBe(true);
      expect(mocks.transaction).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith('[UPDATE_INTERPRETER] Cache refresh failed after commit:', 'Error');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('FAKE_PRIVATE_CACHE_TOKEN');
    } finally {
      warn.mockRestore();
    }
  });

  it('rejects unauthorized edits before any database calls', async () => {
    mocks.auth.mockResolvedValueOnce({ error: 'Forbidden', code: 'UNAUTHORIZED' });
    const result = await updateInterpreter(42, { name: 'Nombre nuevo' });
    expect(result.success).toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.directUpdate).not.toHaveBeenCalled();
  });

  it('redacts errors from the administrative interpreter selector too', async () => {
    mocks.findMany.mockRejectedValueOnce(new Error('FAKE_SENSITIVE_DB_PASSWORD'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await getInterpretersForSelect();
      expect(result).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
      expect(log).toHaveBeenCalledWith('[GET_INTERPRETERS_FOR_SELECT] Failed:', 'Error');
      expect(JSON.stringify(log.mock.calls)).not.toContain('FAKE_SENSITIVE_DB_PASSWORD');
    } finally {
      log.mockRestore();
    }
  });
});
