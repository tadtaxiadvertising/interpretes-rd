// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  listUsers: vi.fn(),
  findProfile: vi.fn(),
  createProfile: vi.fn(),
  updateProfile: vi.fn(),
  findInterpreter: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/prisma', () => ({
  default: {
    userProfile: {
      findUnique: mocks.findProfile,
      create: mocks.createProfile,
      update: mocks.updateProfile,
    },
    interpreter: { findUnique: mocks.findInterpreter },
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { auth: { admin: { listUsers: mocks.listUsers } } },
  ADMIN_UNAVAILABLE_MESSAGE: 'Admin service unavailable',
  isAdminUnavailableError: (e: unknown) =>
    e instanceof Error && e.name === 'SupabaseAdminUnavailableError',
}));
import { syncAllSupabaseUsers } from './admin-users';

const directoryUser = (id: string, email = `${id}@example.test`) => ({
  id, email, user_metadata: { display_name: 'Sample User' },
});
const page = (users: ReturnType<typeof directoryUser>[], nextPage?: number | null) => ({
  data: { users, ...(nextPage === undefined ? {} : { nextPage }) },
  error: null,
});

describe('full Supabase directory sync is safe and truthful', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { role: 'admin', id: 'admin-1' } });
    mocks.listUsers.mockResolvedValue(page([]));
    mocks.findProfile.mockResolvedValue(null);
    mocks.findInterpreter.mockResolvedValue(null);
    mocks.createProfile.mockResolvedValue({ id: 'created-id' });
    mocks.updateProfile.mockResolvedValue({ id: 'updated-id' });
  });

  it('visits every declared page before writing and imports all accounts', async () => {
    mocks.listUsers
      .mockResolvedValueOnce(page([directoryUser('u1')], 2))
      .mockResolvedValueOnce(page([directoryUser('u2')], null));
    const result = await syncAllSupabaseUsers();
    expect(result).toEqual({ success: true, syncedCount: 2 });
    expect(mocks.listUsers).toHaveBeenNthCalledWith(1, { page: 1, perPage: 100 });
    expect(mocks.listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: 100 });
    expect(mocks.createProfile).toHaveBeenCalledTimes(2);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/users');
    const firstReadOrder = mocks.listUsers.mock.invocationCallOrder[0];
    const secondReadOrder = mocks.listUsers.mock.invocationCallOrder[1];
    const firstWriteOrder = mocks.createProfile.mock.invocationCallOrder[0];
    expect(firstReadOrder).toBeLessThan(secondReadOrder);
    expect(secondReadOrder).toBeLessThan(firstWriteOrder);
  });

  it('defaults all imported accounts to onboarding pending and returns only IDs', async () => {
    mocks.listUsers.mockResolvedValue(page([directoryUser('u1')]));
    expect(await syncAllSupabaseUsers()).toMatchObject({ success: true, syncedCount: 1 });
    expect(mocks.createProfile).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: 'u1',
        onboardingComplete: false,
        displayName: 'Sample User',
      }),
      select: { id: true },
    }));
    expect(mocks.findProfile).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { id: true, role: true, interpreterId: true },
    });
  });

  it('stops before ANY write when a later directory page fails', async () => {
    mocks.listUsers
      .mockResolvedValueOnce(page([directoryUser('u1')], 2))
      .mockResolvedValueOnce({ data: { users: [] }, error: new Error('PRIVATE_PROVIDER_TOKEN') });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await syncAllSupabaseUsers();
      expect(result.success).toBe(false);
      expect(result.error).toContain('directorio completo');
      expect(mocks.createProfile).not.toHaveBeenCalled();
      expect(mocks.updateProfile).not.toHaveBeenCalled();
      expect(JSON.stringify(logged.mock.calls)).not.toContain('PRIVATE_PROVIDER_TOKEN');
    } finally {
      logged.mockRestore();
    }
  });

  it('refuses duplicate IDs across paginated results without touching local profiles', async () => {
    mocks.listUsers
      .mockResolvedValueOnce(page([directoryUser('u1')], 2))
      .mockResolvedValueOnce(page([directoryUser('u1')], null));
    const result = await syncAllSupabaseUsers();
    expect(result.success).toBe(false);
    expect(result.error).toContain('paginación');
    expect(mocks.findProfile).not.toHaveBeenCalled();
    expect(mocks.createProfile).not.toHaveBeenCalled();
  });

  it('rejects malformed responses instead of declaring all users synchronized', async () => {
    mocks.listUsers.mockResolvedValueOnce({ data: { users: null }, error: null });
    const result = await syncAllSupabaseUsers();
    expect(result.success).toBe(false);
    expect(mocks.findProfile).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('supports SDK pages without nextPage and detects a full first page', async () => {
    const entries = Array.from({ length: 100 }, (_, i) => directoryUser(`u${i}`, ''));
    mocks.listUsers
      .mockResolvedValueOnce(page(entries))
      .mockResolvedValueOnce(page([]));
    expect(await syncAllSupabaseUsers()).toEqual({ success: true, syncedCount: 0 });
    expect(mocks.listUsers).toHaveBeenCalledTimes(2);
    expect(mocks.createProfile).not.toHaveBeenCalled();
  });

  it('does not claim completion after a database failure with prior committed changes', async () => {
    mocks.listUsers.mockResolvedValue(page([directoryUser('u1'), directoryUser('u2')]));
    mocks.createProfile.mockResolvedValueOnce({ id: 'u1' })
      .mockRejectedValueOnce(new Error('postgresql://svc:PRIVATE_DB_PASS@internal'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await syncAllSupabaseUsers();
      expect(result).toMatchObject({ success: false, partial: true, syncedCount: 1 });
      expect(result.error).toContain('Se actualizaron 1 perfiles');
      expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/users');
      expect(JSON.stringify([result, logged.mock.calls])).not.toMatch(/PRIVATE_DB_PASS|postgresql:/);
    } finally {
      logged.mockRestore();
    }
  });

  it('reports a committed sync as successful when only cache invalidation fails', async () => {
    mocks.listUsers.mockResolvedValue(page([directoryUser('u1')]));
    mocks.revalidatePath.mockImplementationOnce(() => {
      throw new Error('PRIVATE_CACHE_TOKEN');
    });
    const logged = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await syncAllSupabaseUsers()).toEqual({ success: true, syncedCount: 1 });
      expect(mocks.createProfile).toHaveBeenCalledOnce();
      expect(JSON.stringify(logged.mock.calls)).not.toContain('PRIVATE_CACHE_TOKEN');
    } finally {
      logged.mockRestore();
    }
  });

  it('updates roles for existing accounts without rewriting onboarding or identity fields', async () => {
    mocks.listUsers.mockResolvedValue(page([directoryUser('u1')]));
    mocks.findProfile.mockResolvedValue({ id: 'u1', role: 'candidate', interpreterId: null });
    expect(await syncAllSupabaseUsers()).toMatchObject({ success: true, syncedCount: 1 });
    expect(mocks.updateProfile).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { role: 'candidate', interpreterId: undefined },
      select: { id: true },
    });
  });

  it('blocks non-admin callers without querying Supabase or the database', async () => {
    mocks.auth.mockResolvedValue({ user: { role: 'interpreter' } });
    expect((await syncAllSupabaseUsers()).success).toBe(false);
    expect(mocks.listUsers).not.toHaveBeenCalled();
    expect(mocks.findProfile).not.toHaveBeenCalled();
  });

  it('rejects loops and out-of-bounds provider page cursors', async () => {
    mocks.listUsers.mockResolvedValueOnce(page([directoryUser('u1')], 1));
    expect((await syncAllSupabaseUsers()).success).toBe(false);
    expect(mocks.findProfile).not.toHaveBeenCalled();
    mocks.listUsers.mockResolvedValueOnce(page([directoryUser('u2')], 101));
    expect((await syncAllSupabaseUsers()).success).toBe(false);
    expect(mocks.findProfile).not.toHaveBeenCalled();
  });
});
