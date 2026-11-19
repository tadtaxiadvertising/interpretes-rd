// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const m = vi.hoisted(() => ({
  validate: vi.fn(),
  findInterpreter: vi.fn(),
  findLegacy: vi.fn(),
  transaction: vi.fn(),
  createInterpreterRecord: vi.fn(),
  upsertProfile: vi.fn(),
  findAuth: vi.fn(),
  provision: vi.fn(),
  adminAuth: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/actions', () => ({ validateAction: m.validate }));
vi.mock('@/lib/cache/revalidate-interpreter', () => ({
  revalidateInterpreterProfileRecords: m.revalidate,
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: { findFirst: m.findInterpreter },
    rbacUser: { findFirst: m.findLegacy },
    $transaction: m.transaction,
  },
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { get auth() { return m.adminAuth(); } },
  ADMIN_UNAVAILABLE_MESSAGE: 'Synthetic missing admin configuration',
  getSupabaseServiceRoleKey: vi.fn(),
  isAdminUnavailableError: (error: unknown) =>
    error instanceof Error && error.name === 'SupabaseAdminUnavailableError',
}));
vi.mock('@/lib/supabase/auth-users', () => ({
  upsertConfirmedAuthUser: m.provision,
  findAuthUserByEmail: m.findAuth,
}));

import { createInterpreter } from './interpreters';

const input = {
  externalId: 'CI-INTERPRETER-001',
  name: 'Synthetic Interpreter',
  emailCorporativo: 'synthetic@example.test',
  tariffPerMinute: 0.12,
  password: 'fictional-not-a-real-password',
};

function expectNoWrites() {
  expect(m.transaction).not.toHaveBeenCalled();
  expect(m.createInterpreterRecord).not.toHaveBeenCalled();
  expect(m.provision).not.toHaveBeenCalled();
  expect(m.upsertProfile).not.toHaveBeenCalled();
}

describe('admin interpreter form action: safe cross-provider preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.validate.mockResolvedValue({ profile: { role: 'admin' }, user: { userId: 'synthetic-admin' } });
    m.findInterpreter.mockResolvedValue(null);
    m.findLegacy.mockResolvedValue(null);
    m.findAuth.mockResolvedValue(null);
    m.adminAuth.mockReturnValue({ admin: {} });
    m.createInterpreterRecord.mockResolvedValue({
      id: 117, name: input.name, emailCorporativo: input.emailCorporativo,
    });
    m.upsertProfile.mockResolvedValue({ id: 'synthetic-auth-uuid' });
    m.provision.mockResolvedValue({ id: 'synthetic-auth-uuid' });
    m.transaction.mockImplementation(async (callback) => callback({
      interpreter: { create: m.createInterpreterRecord },
      userProfile: { upsert: m.upsertProfile },
    }));
  });

  it('rejects an existing interpreter before touching either Auth provider', async () => {
    m.findInterpreter.mockResolvedValueOnce({ id: 117 });
    const result = await createInterpreter(input as never);
    expect(result).toMatchObject({ success: false, code: 'CONFLICT' });
    expect(m.findLegacy).not.toHaveBeenCalled();
    expect(m.findAuth).not.toHaveBeenCalled();
    expectNoWrites();
    expect(JSON.stringify(result)).not.toContain('117');
  });

  it('probes local natural identifiers case-insensitively', async () => {
    const result = await createInterpreter(input as never);
    expect(result.success).toBe(true);
    expect(m.findInterpreter).toHaveBeenCalledWith({
      where: {
        OR: [
          { externalId: { equals: input.externalId, mode: 'insensitive' } },
          { emailCorporativo: { equals: input.emailCorporativo, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    expect(m.findInterpreter.mock.invocationCallOrder[0])
      .toBeLessThan(m.findLegacy.mock.invocationCallOrder[0]);
  });

  it('does not create a second login for an existing legacy RBAC email', async () => {
    m.findLegacy.mockResolvedValueOnce({ id: 'different-rbac-identity' });
    const result = await createInterpreter(input as never);
    expect(result).toMatchObject({ success: false, code: 'CONFLICT' });
    expect(result.error).toContain('acceso heredado');
    expect(m.findLegacy).toHaveBeenCalledWith({
      where: { email: { equals: input.emailCorporativo, mode: 'insensitive' } },
      select: { id: true },
    });
    expect(m.findAuth).not.toHaveBeenCalled();
    expectNoWrites();
    expect(JSON.stringify(result)).not.toContain('different-rbac-identity');
  });

  it('blocks unavailable legacy identity checks, with safe logs and no writes', async () => {
    const failure = new Error('postgresql://PRIVATE_LEGACY_PASSWORD@host.invalid');
    failure.name = 'Bearer PRIVATE_LEGACY_TOKEN';
    m.findLegacy.mockRejectedValueOnce(failure);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await createInterpreter(input as never);
      expect(result).toMatchObject({ success: false, code: 'SERVICE_UNAVAILABLE' });
      expect(JSON.stringify([result, warn.mock.calls]))
        .not.toMatch(/PRIVATE_|postgresql:|host\.invalid/);
      expect(m.findAuth).not.toHaveBeenCalled();
      expectNoWrites();
    } finally {
      warn.mockRestore();
    }
  });

  it('blocks an existing Supabase Auth email without linking it by email', async () => {
    m.findAuth.mockResolvedValueOnce({ id: 'another-provider-uuid' });
    const result = await createInterpreter(input as never);
    expect(result).toMatchObject({ success: false, code: 'CONFLICT' });
    expect(result.error).toContain('cuenta de autenticación');
    expect(JSON.stringify(result)).not.toContain('another-provider-uuid');
    expectNoWrites();
  });

  it('fails closed if the Supabase email lookup is unavailable', async () => {
    const error = new Error('postgresql://PRIVATE_AUTH_KEY@auth.invalid');
    m.findAuth.mockRejectedValueOnce(error);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await createInterpreter(input as never);
      expect(result).toMatchObject({ success: false, code: 'SERVICE_UNAVAILABLE' });
      expect(JSON.stringify([result, warn.mock.calls]))
        .not.toMatch(/PRIVATE_|postgresql:|auth\.invalid/);
      expectNoWrites();
    } finally {
      warn.mockRestore();
    }
  });

  it('creates and links an interpreter only after all three read checks', async () => {
    const result = await createInterpreter(input as never);
    expect(result).toEqual({ success: true, data: { id: 117, name: input.name } });
    expect(m.findInterpreter).toHaveBeenCalledOnce();
    expect(m.findLegacy).toHaveBeenCalledOnce();
    expect(m.findAuth).toHaveBeenCalledOnce();
    expect(m.transaction).toHaveBeenCalledOnce();
    expect(m.provision).toHaveBeenCalledOnce();
    expect(m.upsertProfile).toHaveBeenCalledOnce();
    const seq = [m.findInterpreter,m.findLegacy,m.findAuth,m.createInterpreterRecord,m.provision,m.upsertProfile]
      .map(fn => fn.mock.invocationCallOrder[0]);
    expect(seq).toEqual([...seq].sort((a,b) => a-b));
    expect(m.revalidate).toHaveBeenCalledWith(117);
  });

  it('does not report a failed creation if post-commit cache refresh throws', async () => {
    const failure = new Error('PRIVATE_CACHE_REFRESH_FAILURE');
    m.revalidate.mockImplementationOnce(() => { throw failure; });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await createInterpreter(input as never);
      expect(result).toEqual({ success: true, data: { id: 117, name: input.name } });
      expect(m.transaction).toHaveBeenCalledOnce();
      expect(m.provision).toHaveBeenCalledOnce();
      expect(m.upsertProfile).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith('[CREATE_INTERPRETER] Cache refresh failed after commit:', 'Error');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_CACHE_REFRESH_FAILURE');
    } finally {
      warn.mockRestore();
    }
  });

  it('skips external and legacy checks on a deliberately passwordless create', async () => {
    const { password: _password, ...passwordless } = input;
    const result = await createInterpreter(passwordless as never);
    expect(result.success).toBe(true);
    expect(m.findLegacy).not.toHaveBeenCalled();
    expect(m.findAuth).not.toHaveBeenCalled();
    expect(m.provision).not.toHaveBeenCalled();
    expect(m.upsertProfile).not.toHaveBeenCalled();
  });

  it('does not start a transaction when email is missing for a password', async () => {
    const result = await createInterpreter({ ...input, emailCorporativo: null } as never);
    expect(result).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    expect(m.findInterpreter).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it('turns a raced Prisma unique-key conflict into a safe response', async () => {
    m.createInterpreterRecord.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('PRIVATE_CONFLICT_DETAILS', {
        code: 'P2002', clientVersion: '7.10.1',
      }),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await createInterpreter(input as never);
      expect(result).toMatchObject({ success: false, code: 'CONFLICT' });
      expect(JSON.stringify([result, log.mock.calls])).not.toContain('PRIVATE_CONFLICT_DETAILS');
      expect(m.provision).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('signals uncertain partial Auth provisioning without leaking provider errors', async () => {
    const failure = new Error('postgresql://PRIVATE_PROFILE_SECRET@db.invalid');
    failure.name = 'PRIVATE_PROVIDER_TOKEN';
    m.upsertProfile.mockRejectedValueOnce(failure);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await createInterpreter(input as never);
      expect(result).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
      expect(result.error).toContain('podría existir');
      expect(result.error).toContain('antes de reintentar');
      expect(m.provision).toHaveBeenCalledOnce();
      expect(JSON.stringify([result,log.mock.calls]))
        .not.toMatch(/PRIVATE_|postgresql:|db\.invalid/);
      expect(m.revalidate).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('returns a safe uncertainty warning when the Auth operation itself fails', async () => {
    const error = new Error('PRIVATE_SUPABASE_USER_ERROR');
    m.provision.mockRejectedValueOnce(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await createInterpreter(input as never);
      expect(result).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
      expect(result.error).toContain('antes de reintentar');
      expect(JSON.stringify([result, log.mock.calls])).not.toContain('PRIVATE_SUPABASE_USER_ERROR');
      expect(m.upsertProfile).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('sanitizes validation failures without calling any database client', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await createInterpreter({ ...input, tariffPerMinute: -1 } as never);
      expect(result).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
      expect(JSON.stringify([result,log.mock.calls])).not.toContain('PRIVATE_');
      expect(m.findInterpreter).not.toHaveBeenCalled();
      expectNoWrites();
    } finally {
      log.mockRestore();
    }
  });

  it('rejects unprivileged Server Action calls before any lookups', async () => {
    m.validate.mockResolvedValueOnce({ error: 'Forbidden', code: 'UNAUTHORIZED' });
    const result = await createInterpreter(input as never);
    expect(result).toMatchObject({ success: false, code: 'UNAUTHORIZED' });
    expect(m.findInterpreter).not.toHaveBeenCalled();
    expectNoWrites();
  });
});
