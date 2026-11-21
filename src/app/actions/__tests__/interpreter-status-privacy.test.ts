// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  validate: vi.fn(),
  update: vi.fn(),
  revalidateProfile: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: { interpreter: { update: mocks.update } },
}));
vi.mock('@/lib/auth/actions', () => ({ validateAction: mocks.validate }));
vi.mock('@/lib/cache/revalidate-interpreter', () => ({
  revalidateInterpreterProfileRecords: mocks.revalidateProfile,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/validators', () => ({
  InterpreterSchema: { partial: () => ({ parse: (input: unknown) => input }) },
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

import { updateRealtimeStatus, updateInterpreterStatusAction } from '../interpreters';

const admin = { user: { role: 'admin', interpreterId: null }, profile: { role: 'admin', interpreterId: null } };
const interpreter = (id: number) => ({
  user: { role: 'interpreter', interpreterId: id },
  profile: { role: 'interpreter', interpreterId: id },
});

describe('interpreter status Server Actions: authorization, privacy, postcommit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validate.mockResolvedValue(admin);
    mocks.update.mockResolvedValue({ id: 42, status: 'Inactivo' });
  });

  it('rejects malformed realtime IDs and unauthorized enum values before database writes', async () => {
    for (const [id, status] of [
      [0, 'Online'], [-1, 'Busy'], [1.5, 'Offline'], [Number.POSITIVE_INFINITY, 'Online'],
      [42, 'FAKE_UNRECOGNIZED_STATUS'],
    ] as const) {
      expect(await updateRealtimeStatus(id, status as 'Online')).toMatchObject({
        success: false, code: 'VALIDATION_ERROR',
      });
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('prevents interpreters from altering another interpreter presence', async () => {
    mocks.validate.mockResolvedValue(interpreter(7));
    expect(await updateRealtimeStatus(42, 'Online')).toMatchObject({
      success: false, code: 'UNAUTHORIZED',
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('allows an interpreter to update their own presence', async () => {
    mocks.validate.mockResolvedValue(interpreter(42));
    expect(await updateRealtimeStatus(42, 'Busy')).toEqual({ success: true });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 42 }, data: { realtimeStatus: 'Busy' }, select: { id: true },
    });
    expect(mocks.revalidateProfile).toHaveBeenCalledWith(42);
  });

  it('returns realtime success after committed DB update despite a failing cache', async () => {
    mocks.revalidateProfile.mockImplementationOnce(() => {
      throw new Error('SYNTHETIC_PRIVATE_CACHE_TOKEN');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await updateRealtimeStatus(42, 'Offline')).toEqual({ success: true });
      expect(mocks.update).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith(
        '[UPDATE_REALTIME_STATUS] Cache refresh failed after commit:', 'Error',
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain('SYNTHETIC_PRIVATE_CACHE_TOKEN');
    } finally { warn.mockRestore(); }
  });

  it('redacts realtime database failures without claiming success', async () => {
    mocks.update.mockRejectedValueOnce(new Error('postgresql://admin:SYNTHETIC_SECRET@db.invalid'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await updateRealtimeStatus(42, 'Online')).toMatchObject({
        success: false, code: 'INTERNAL_ERROR',
      });
      expect(mocks.revalidateProfile).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith('[UPDATE_REALTIME_STATUS] Failed:', 'Error');
      expect(JSON.stringify(log.mock.calls)).not.toContain('SYNTHETIC_SECRET');
    } finally { log.mockRestore(); }
  });

  it('rejects non-admin status changes before validating or writing', async () => {
    mocks.validate.mockResolvedValueOnce({ error: 'Forbidden', code: 'UNAUTHORIZED' });
    expect(await updateInterpreterStatusAction({ id: 42, status: 'Inactivo' }))
      .toMatchObject({ success: false });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('rejects unknown fields and invalid statuses without exposing supplied values', async () => {
    const malformed = [
      { id: 42, status: 'FAKE_PRIVATE_STATUS' },
      { id: 42, status: 'Activo', injected: 'FAKE_SECRET' },
      { id: -1, status: 'Inactivo' },
    ];
    for (const payload of malformed) {
      const result = await updateInterpreterStatusAction(payload);
      expect(result).toEqual({ success: false, error: 'Estado o intérprete inválido.' });
      expect(JSON.stringify(result)).not.toMatch(/FAKE_PRIVATE_STATUS|FAKE_SECRET/);
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('never returns or logs unredacted Prisma messages on status update failure', async () => {
    mocks.update.mockRejectedValueOnce(new Error('postgresql://api:SYNTHETIC_PASSWORD@private.invalid'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await updateInterpreterStatusAction({ id: 42, status: 'Inactivo' });
      expect(result).toEqual({ success: false, error: 'No se pudo actualizar el estado del intérprete.' });
      expect(log).toHaveBeenCalledWith('[UPDATE_INTERPRETER_STATUS] Failed:', 'Error');
      expect(JSON.stringify([result, log.mock.calls])).not.toMatch(/SYNTHETIC_PASSWORD|private\.invalid/);
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
      expect(mocks.revalidateProfile).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it('continues refreshing every cache after the confirmed status write', async () => {
    mocks.revalidatePath.mockImplementationOnce(() => { throw new Error('SYNTHETIC_CACHE_TOKEN'); });
    mocks.revalidateProfile.mockImplementationOnce(() => { throw new Error('SYNTHETIC_PROFILE_TOKEN'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await updateInterpreterStatusAction({ id: 42, status: 'Inactivo' });
      expect(result).toEqual({ success: true, data: { id: 42, status: 'Inactivo' } });
      expect(mocks.update).toHaveBeenCalledOnce();
      expect(mocks.revalidatePath.mock.calls.map(([path]) => path))
        .toEqual(['/admin/roster', '/interpreters']);
      expect(mocks.revalidateProfile).toHaveBeenCalledWith(42);
      expect(warn).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/SYNTHETIC_CACHE_TOKEN|SYNTHETIC_PROFILE_TOKEN/);
    } finally { warn.mockRestore(); }
  });
});
