// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/actions/auth', () => ({
  getCurrentProfile: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    client: { findFirst: vi.fn() },
    company: { findFirst: vi.fn() },
    account: { create: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getCurrentProfile } from '@/app/actions/auth';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { createOperationalAccount, updateOperationalAccount } from './admin-accounts';

function accountForm(extra: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    accountId: '12',
    clientId: '7',
    companyId: '',
    name: 'Primary Work Account',
    holderName: 'Example Interpreter',
    email: 'staff@example.test',
    loginUrl: 'https://portal.example.test/login',
    secretRef: 'vault://example/account/main',
    description: '',
    ...extra,
  })) data.set(key, value);
  return data;
}

describe('operational account post-commit behavior and privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentProfile).mockResolvedValue({ role: 'admin' } as never);
    vi.mocked(prisma.client.findFirst).mockResolvedValue({ id: 7 } as never);
    vi.mocked(prisma.account.findUnique).mockResolvedValue({ id: 12 } as never);
    vi.mocked(prisma.account.create).mockResolvedValue({ id: 12 } as never);
    vi.mocked(prisma.$transaction).mockResolvedValue(undefined as never);
  });

  it('reports a committed creation as successful and refreshes remaining pages when cache fails', async () => {
    vi.mocked(revalidatePath).mockImplementationOnce(() => { throw new Error('PRIVATE_CACHE_SECRET'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await createOperationalAccount(accountForm())).toEqual({ success: true });
      expect(prisma.account.create).toHaveBeenCalledTimes(1);
      expect(revalidatePath).toHaveBeenNthCalledWith(1, '/admin/accounts');
      expect(revalidatePath).toHaveBeenNthCalledWith(2, '/admin/clients');
      expect(warn).toHaveBeenCalledWith('[ADMIN_ACCOUNTS] Saved but cache refresh failed:', 'Error');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_CACHE_SECRET');
      expect(error).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); error.mockRestore(); }
  });

  it('does not request new VPN columns as part of an account creation response', async () => {
    expect(await createOperationalAccount(accountForm())).toEqual({ success: true });
    expect(prisma.account.create).toHaveBeenCalledWith(
      expect.objectContaining({ select: { id: true } }),
    );
  });

  it.each([true, false])(
    'limits platform mutation responses to an ID when updating an account (platform exists: %s)',
    async platformExists => {
      const tx = {
        account: { update: vi.fn().mockResolvedValue({ id: 12 }) },
        accountPlatform: {
          findFirst: vi.fn().mockResolvedValue(platformExists ? { id: 19 } : null),
          update: vi.fn().mockResolvedValue({ id: 19 }),
          create: vi.fn().mockResolvedValue({ id: 19 }),
        },
      };
      vi.mocked(prisma.$transaction).mockImplementationOnce(async callback =>
        callback(tx as never) as never,
      );

      expect(await updateOperationalAccount(accountForm())).toEqual({ success: true });
      expect(tx.account.update).toHaveBeenCalledWith(
        expect.objectContaining({ select: { id: true } }),
      );
      const mutation = platformExists ? tx.accountPlatform.update : tx.accountPlatform.create;
      expect(mutation).toHaveBeenCalledWith(
        expect.objectContaining({ select: { id: true } }),
      );
      expect(platformExists ? tx.accountPlatform.create : tx.accountPlatform.update)
        .not.toHaveBeenCalled();
    },
  );

  it('reports a committed account update as successful when cache refresh fails', async () => {
    vi.mocked(revalidatePath).mockImplementationOnce(() => { throw new Error('PRIVATE_REFRESH_TOKEN'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await updateOperationalAccount(accountForm())).toEqual({ success: true });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(revalidatePath).toHaveBeenNthCalledWith(1, '/admin/accounts');
      expect(revalidatePath).toHaveBeenNthCalledWith(2, '/admin/clients');
      expect(warn).toHaveBeenCalledWith('[ADMIN_ACCOUNTS] Saved but cache refresh failed:', 'Error');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_REFRESH_TOKEN');
      expect(error).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); error.mockRestore(); }
  });

  it('redacts database connection information when creation fails before commit', async () => {
    vi.mocked(prisma.account.create).mockRejectedValueOnce(
      new Error('postgresql://admin:PRIVATE_PASSWORD@db.internal/accounts'),
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await createOperationalAccount(accountForm())).toEqual({
        success: false, error: 'No se pudo crear la cuenta.',
      });
      expect(revalidatePath).not.toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith('[ADMIN_ACCOUNTS] Create failed:', 'Error');
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(/PRIVATE_PASSWORD|db\\.internal|postgresql:/);
    } finally { spy.mockRestore(); }
  });

  it('redacts database connection information when the update transaction fails', async () => {
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(
      new Error('postgresql://admin:PRIVATE_PASSWORD@db.internal/accounts'),
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await updateOperationalAccount(accountForm())).toEqual({
        success: false, error: 'No se pudo actualizar la cuenta.',
      });
      expect(revalidatePath).not.toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith('[ADMIN_ACCOUNTS] Update failed:', 'Error');
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(/PRIVATE_PASSWORD|db\\.internal|postgresql:/);
    } finally { spy.mockRestore(); }
  });

  it('does not let interpreters write account data', async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue({ role: 'interpreter' } as never);
    expect((await createOperationalAccount(accountForm())).success).toBe(false);
    expect((await updateOperationalAccount(accountForm())).success).toBe(false);
    expect(prisma.account.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
