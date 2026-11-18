// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findProfile: vi.fn(),
  updateProfile: vi.fn(),
  findInterpreter: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/prisma', () => ({
  default: {
    userProfile: { findUnique: mocks.findProfile, update: mocks.updateProfile },
    interpreter: { findUnique: mocks.findInterpreter },
  },
}));
vi.mock('@/lib/cache/revalidate-interpreter', () => ({
  revalidateInterpreterProfileRecords: mocks.refresh,
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { auth: { admin: {} } },
  ADMIN_UNAVAILABLE_MESSAGE: 'Unavailable',
  isAdminUnavailableError: vi.fn(),
}));
import { linkUserToInterpreter } from './admin-users';
import { PROTECTED_ADMIN_EMAILS } from '@/lib/admin-identity';

describe('admin user / interpreter linking authorization and consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } });
    mocks.findProfile.mockResolvedValue({
      interpreterId: 9, role: 'interpreter', email: 'interpreter@example.test',
    });
    mocks.findInterpreter.mockResolvedValue({ id: 12 });
    mocks.updateProfile.mockResolvedValue({ interpreterId: 12 });
  });

  it('updates a valid link while querying only the necessary fields', async () => {
    expect(await linkUserToInterpreter('user-1', 12)).toEqual({ success: true });
    expect(mocks.findProfile).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { interpreterId: true, email: true, role: true },
    });
    expect(mocks.findInterpreter).toHaveBeenCalledWith({
      where: { id: 12 },
      select: { id: true },
    });
    expect(mocks.updateProfile).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { interpreterId: 12 },
      select: { interpreterId: true },
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).toHaveBeenCalledWith(9);
    expect(mocks.refresh).toHaveBeenCalledWith(12);
  });

  it('supports unlinking, without requiring an interpreter lookup', async () => {
    expect(await linkUserToInterpreter('user-1', null)).toEqual({ success: true });
    expect(mocks.findInterpreter).not.toHaveBeenCalled();
    expect(mocks.updateProfile).toHaveBeenCalledWith(expect.objectContaining({
      data: { interpreterId: null },
    }));
    expect(mocks.refresh).toHaveBeenCalledWith(null);
  });

  it.each([0, -2, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '12'])(
    'rejects malformed interpreter id %s before reading the database',
    async invalid => {
      expect((await linkUserToInterpreter('user-1', invalid as never)).success).toBe(false);
      expect(mocks.findProfile).not.toHaveBeenCalled();
      expect(mocks.updateProfile).not.toHaveBeenCalled();
    },
  );

  it('does not link a missing user', async () => {
    mocks.findProfile.mockResolvedValueOnce(null);
    expect((await linkUserToInterpreter('user-1', 12)).success).toBe(false);
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it('does not link a missing interpreter', async () => {
    mocks.findInterpreter.mockResolvedValueOnce(null);
    expect((await linkUserToInterpreter('user-1', 12)).success).toBe(false);
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it('blocks an ordinary admin profile from linking to an interpreter', async () => {
    mocks.findProfile.mockResolvedValueOnce({
      interpreterId: null, role: 'admin', email: 'admin@example.test',
    });
    expect((await linkUserToInterpreter('admin-2', 12)).success).toBe(false);
    expect(mocks.findInterpreter).not.toHaveBeenCalled();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it('protects the specially configured admin even if its database role is stale', async () => {
    mocks.findProfile.mockResolvedValueOnce({
      interpreterId: null, role: 'interpreter', email: PROTECTED_ADMIN_EMAILS[0],
    });
    expect((await linkUserToInterpreter('protected-id', 12)).success).toBe(false);
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it.each([
    ['P2002', 'otra cuenta'],
    ['P2025', 'ya no existe'],
  ])('returns an actionable, private message for Prisma %s', async (code, message) => {
    mocks.updateProfile.mockRejectedValueOnce({ code, message: 'postgresql://PRIVATE_PASSWORD@db' });
    const result = await linkUserToInterpreter('user-1', 12);
    expect(result.success).toBe(false);
    expect(result.error).toContain(message);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PASSWORD');
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('redacts unexpected database errors and does not refresh before commit', async () => {
    mocks.updateProfile.mockRejectedValueOnce(new Error('postgresql://PRIVATE_PASSWORD@db'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await linkUserToInterpreter('user-1', 12);
      expect(result.success).toBe(false);
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(JSON.stringify([result, errors.mock.calls])).not.toMatch(/PRIVATE_PASSWORD|postgresql:/);
    } finally { errors.mockRestore(); }
  });

  it('does not report an already committed link as failed when refresh throws', async () => {
    mocks.refresh.mockImplementationOnce(() => { throw new Error('PRIVATE_CACHE_TOKEN'); });
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await linkUserToInterpreter('user-1', 12)).toEqual({ success: true });
      expect(mocks.updateProfile).toHaveBeenCalledOnce();
      expect(mocks.refresh).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(warnings.mock.calls)).not.toContain('PRIVATE_CACHE_TOKEN');
    } finally { warnings.mockRestore(); }
  });

  it('skips a redundant duplicate cache refresh if the linked id did not change', async () => {
    mocks.findProfile.mockResolvedValueOnce({
      interpreterId: 12, email: 'interpreter@example.test', role: 'interpreter',
    });
    expect(await linkUserToInterpreter('user-1', 12)).toEqual({ success: true });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('blocks callers without administrative permissions before accessing data', async () => {
    mocks.auth.mockResolvedValueOnce({ user: { role: 'candidate' } });
    await expect(linkUserToInterpreter('user-1', 12)).rejects.toThrow('Unauthorized');
    expect(mocks.findProfile).not.toHaveBeenCalled();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });
});
