// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  validate: vi.fn(),
  findInterpreter: vi.fn(),
  findLegacy: vi.fn(),
  findAuth: vi.fn(),
  provision: vi.fn(),
  profileUpsert: vi.fn(),
  adminAuth: vi.fn(),
  updateAuth: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/actions', () => ({ validateAction: m.validate }));
vi.mock('@/lib/cache/revalidate-interpreter', () => ({
  revalidateInterpreterProfileRecords: m.revalidate,
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: { findUnique: m.findInterpreter },
    rbacUser: { findFirst: m.findLegacy },
    userProfile: { upsert: m.profileUpsert },
  },
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { get auth() { return m.adminAuth(); } },
  ADMIN_UNAVAILABLE_MESSAGE: 'Synthetic admin service unavailable',
  isAdminUnavailableError: (error: unknown) => error instanceof Error &&
    error.name === 'SupabaseAdminUnavailableError',
  getSupabaseServiceRoleKey: vi.fn(),
}));
vi.mock('@/lib/supabase/auth-users', () => ({
  upsertConfirmedAuthUser: m.provision,
  findAuthUserByEmail: m.findAuth,
}));

import { resetInterpreterPassword } from './interpreters';

const interpreter = {
  id: 21,
  name: 'Synthetic Interpreter',
  emailCorporativo: 'synthetic@example.test',
  userProfile: null,
};
const fictionalPassword = 'synthetic-password-not-real';

const expectNoWrites = () => {
  expect(m.updateAuth).not.toHaveBeenCalled();
  expect(m.provision).not.toHaveBeenCalled();
  expect(m.profileUpsert).not.toHaveBeenCalled();
};

describe('admin interpreter password reset and missing-link provisioning', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.validate.mockResolvedValue({ user: { userId: 'fictional-admin' }, profile: { role: 'admin' } });
    m.findInterpreter.mockResolvedValue(interpreter);
    m.findLegacy.mockResolvedValue(null);
    m.findAuth.mockResolvedValue(null);
    m.adminAuth.mockReturnValue({ admin: { updateUserById: m.updateAuth } });
    m.updateAuth.mockResolvedValue({ error: null });
    m.provision.mockResolvedValue({ id: 'fictional-new-auth-id' });
    m.profileUpsert.mockResolvedValue({ id: 'fictional-new-auth-id' });
  });

  it('rejects non-admin requests before any identity reads or writes', async () => {
    m.validate.mockResolvedValueOnce({ error: 'Forbidden', code: 'UNAUTHORIZED' });
    const result = await resetInterpreterPassword(21, fictionalPassword);
    expect(result).toMatchObject({ success: false, code: 'UNAUTHORIZED' });
    expect(m.findInterpreter).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it('validates interpreter id and password before querying the database', async () => {
    for (const [id, pw] of [[0, fictionalPassword], [21, 'short'], [Number.NaN, fictionalPassword]] as const) {
      const result = await resetInterpreterPassword(id, pw);
      expect(result).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    }
    expect(m.findInterpreter).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it('requires an existing local interpreter', async () => {
    m.findInterpreter.mockResolvedValueOnce(null);
    expect(await resetInterpreterPassword(21, fictionalPassword))
      .toMatchObject({ success: false, code: 'NOT_FOUND' });
    expect(m.findLegacy).not.toHaveBeenCalled();
    expect(m.findAuth).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it('updates a known linked Auth UUID without account discovery or creation', async () => {
    m.findInterpreter.mockResolvedValueOnce({
      ...interpreter, userProfile: { id: 'already-linked-auth-uuid' },
    });
    expect(await resetInterpreterPassword(21, fictionalPassword)).toEqual({ success: true });
    expect(m.updateAuth).toHaveBeenCalledWith('already-linked-auth-uuid', {
      password: fictionalPassword, email_confirm: true,
    });
    expect(m.findLegacy).not.toHaveBeenCalled();
    expect(m.findAuth).not.toHaveBeenCalled();
    expect(m.provision).not.toHaveBeenCalled();
    expect(m.profileUpsert).not.toHaveBeenCalled();
    expect(m.revalidate).toHaveBeenCalledWith(21);
  });

  it('reports uncertainty on provider update error without exposing credentials', async () => {
    m.findInterpreter.mockResolvedValueOnce({
      ...interpreter, userProfile: { id: 'already-linked-auth-uuid' },
    });
    const err = new Error('postgresql://PRIVATE_PASSWORD@auth.invalid');
    err.name = 'PRIVATE_BEARER_TOKEN';
    m.updateAuth.mockResolvedValueOnce({ error: err });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await resetInterpreterPassword(21, fictionalPassword);
      expect(result).toMatchObject({ success: false, code: 'PARTIAL_FAILURE' });
      expect(result.error).toContain('antes de reintentar');
      expect(JSON.stringify([result, log.mock.calls]))
        .not.toMatch(/PRIVATE_|postgresql:|auth\.invalid/);
      expect(m.revalidate).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it('refuses provisioning without a corporate email and an existing linked profile', async () => {
    m.findInterpreter.mockResolvedValueOnce({ ...interpreter, emailCorporativo: null });
    expect(await resetInterpreterPassword(21, fictionalPassword))
      .toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    expect(m.findLegacy).not.toHaveBeenCalled();
    expect(m.findAuth).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it('blocks a possible Auth.js login instead of creating another Auth identity', async () => {
    m.findLegacy.mockResolvedValueOnce({ id: 'potentially-unrelated-rbac-id' });
    const result = await resetInterpreterPassword(21, fictionalPassword);
    expect(result).toMatchObject({ success: false, code: 'CONFLICT' });
    expect(result.error).toContain('acceso heredado');
    expect(m.findLegacy).toHaveBeenCalledWith({
      where: { email: { equals: interpreter.emailCorporativo, mode: 'insensitive' } },
      select: { id: true },
    });
    expect(JSON.stringify(result)).not.toContain('potentially-unrelated-rbac-id');
    expect(m.findAuth).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it('fails closed and redacts logs when the legacy directory is unavailable', async () => {
    const err = new Error('postgresql://PRIVATE_LEGACY_SECRET@db.invalid');
    err.name = 'PRIVATE_ACCESS_TOKEN';
    m.findLegacy.mockRejectedValueOnce(err);
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await resetInterpreterPassword(21, fictionalPassword);
      expect(result).toMatchObject({ success: false, code: 'SERVICE_UNAVAILABLE' });
      expect(JSON.stringify([result, spy.mock.calls]))
        .not.toMatch(/PRIVATE_|postgresql:|db\.invalid/);
      expect(m.findAuth).not.toHaveBeenCalled();
      expectNoWrites();
    } finally { spy.mockRestore(); }
  });

  it('never auto-links an already-used Supabase email', async () => {
    m.findAuth.mockResolvedValueOnce({ id: 'existing-auth-uuid' });
    const result = await resetInterpreterPassword(21, fictionalPassword);
    expect(result).toMatchObject({ success: false, code: 'CONFLICT' });
    expect(result.error).toContain('requiere revisión');
    expect(JSON.stringify(result)).not.toContain('existing-auth-uuid');
    expectNoWrites();
  });

  it('fails closed on Supabase identity lookup failure without provisioning', async () => {
    m.findAuth.mockRejectedValueOnce(new Error('PRIVATE_SUPABASE_DIRECTORY_KEY'));
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await resetInterpreterPassword(21, fictionalPassword);
      expect(result).toMatchObject({ success: false, code: 'SERVICE_UNAVAILABLE' });
      expect(JSON.stringify([result, spy.mock.calls]))
        .not.toContain('PRIVATE_SUPABASE_DIRECTORY_KEY');
      expectNoWrites();
    } finally { spy.mockRestore(); }
  });

  it('creates missing Auth identity only after RBAC and Supabase checks pass', async () => {
    const result = await resetInterpreterPassword(21, fictionalPassword);
    expect(result).toEqual({ success: true });
    expect(m.findLegacy).toHaveBeenCalledOnce();
    expect(m.findAuth).toHaveBeenCalledOnce();
    expect(m.provision).toHaveBeenCalledWith({
      email: interpreter.emailCorporativo,
      password: fictionalPassword,
      displayName: interpreter.name,
    });
    expect(m.profileUpsert).toHaveBeenCalledWith({
      where: { id: 'fictional-new-auth-id' },
      update: { interpreterId: 21, onboardingComplete: true },
      create: {
        id: 'fictional-new-auth-id',
        email: interpreter.emailCorporativo,
        displayName: interpreter.name,
        role: 'interpreter',
        interpreterId: 21,
        onboardingComplete: true,
      },
    });
    const ordered = [m.findLegacy, m.findAuth, m.provision, m.profileUpsert]
      .map(fn => fn.mock.invocationCallOrder[0]);
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
  });

  it('warns of partial creation if profile linkage fails after Auth user creation', async () => {
    const err = new Error('postgresql://PRIVATE_PROFILE_KEY@db.invalid');
    err.name = 'PRIVATE_PROVIDER_TOKEN';
    m.profileUpsert.mockRejectedValueOnce(err);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await resetInterpreterPassword(21, fictionalPassword);
      expect(result).toMatchObject({ success: false, code: 'PARTIAL_FAILURE' });
      expect(result.error).toContain('Verifica la identidad');
      expect(m.provision).toHaveBeenCalledOnce();
      expect(JSON.stringify([result, spy.mock.calls]))
        .not.toMatch(/PRIVATE_|postgresql:|db\.invalid/);
    } finally { spy.mockRestore(); }
  });

  it('warns of uncertain Auth state if the provider creation request throws', async () => {
    m.provision.mockRejectedValueOnce(new Error('PRIVATE_SUPABASE_USER_FAILURE'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await resetInterpreterPassword(21, fictionalPassword);
      expect(result).toMatchObject({ success: false, code: 'PARTIAL_FAILURE' });
      expect(m.profileUpsert).not.toHaveBeenCalled();
      expect(JSON.stringify([result, spy.mock.calls]))
        .not.toContain('PRIVATE_SUPABASE_USER_FAILURE');
    } finally { spy.mockRestore(); }
  });

  it('does not turn post-write cache failure into false reset failure', async () => {
    m.revalidate.mockImplementationOnce(() => { throw new Error('PRIVATE_CACHE_SECRET'); });
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await resetInterpreterPassword(21, fictionalPassword);
      expect(result).toEqual({ success: true });
      expect(m.provision).toHaveBeenCalledOnce();
      expect(m.profileUpsert).toHaveBeenCalledOnce();
      expect(JSON.stringify(spy.mock.calls)).not.toContain('PRIVATE_CACHE_SECRET');
    } finally { spy.mockRestore(); }
  });

  it('aborts before Auth writes if the admin client is unavailable', async () => {
    m.adminAuth.mockImplementationOnce(() => { throw new Error('PRIVATE_ADMIN_CONFIG'); });
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await resetInterpreterPassword(21, fictionalPassword);
      expect(result).toMatchObject({ success: false, code: 'SERVICE_UNAVAILABLE' });
      expect(JSON.stringify([result, spy.mock.calls])).not.toContain('PRIVATE_ADMIN_CONFIG');
      expect(m.findLegacy).not.toHaveBeenCalled();
      expectNoWrites();
    } finally { spy.mockRestore(); }
  });
});
