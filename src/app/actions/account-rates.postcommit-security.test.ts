// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: {
    client: { findFirst: vi.fn() },
    account: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
    interpreterAccountRate: { delete: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/auth/actions', () => ({
  validateAction: vi.fn(),
}));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { revalidatePath } from 'next/cache';
import {
  createAccount, updateAccount, deleteAccount, getAccounts,
  setInterpreterAccountRate, deleteInterpreterAccountRate,
} from './account-rates';

const account = {
  id: 4, name: 'Work Account', description: 'Notes',
  clientId: 3, client: { name: 'Client' },
};

describe('account and payrate actions preserve committed writes and private logs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateAction).mockResolvedValue({ user: { userId: 'admin-user' } } as never);
    vi.mocked(prisma.client.findFirst).mockResolvedValue({ id: 3, name: 'Client' } as never);
    vi.mocked(prisma.account.create).mockResolvedValue(account as never);
    vi.mocked(prisma.account.update).mockResolvedValue(account as never);
    vi.mocked(prisma.account.delete).mockResolvedValue({ id: 4 } as never);
    vi.mocked(prisma.account.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.interpreterAccountRate.delete).mockResolvedValue({ interpreterId: 2 } as never);
  });

  function failCacheWithPrivateValue() {
    vi.mocked(revalidatePath).mockImplementationOnce(() => {
      throw new Error('postgresql://admin:PRIVATE_PASSWORD@db.internal.invalid/production');
    });
    return vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  }

  it('reports saved account creation after a cache error and refreshes remaining pages', async () => {
    const warning = failCacheWithPrivateValue();
    try {
      const result = await createAccount('Work Account', 'Notes', 3);
      expect(result.success).toBe(true);
      expect(prisma.account.create).toHaveBeenCalledTimes(1);
      expect(revalidatePath).toHaveBeenCalledTimes(4);
      expect(warning).toHaveBeenCalledWith('[ACCOUNT_RATES] Saved but cache refresh failed:', 'Error');
      expect(JSON.stringify(warning.mock.calls)).not.toMatch(/PRIVATE_PASSWORD|postgresql:/);
    } finally {
      warning.mockRestore();
    }
  });

  it('reports saved updates and deletes without asking the operator to repeat a committed write', async () => {
    const warning = failCacheWithPrivateValue();
    try {
      expect((await updateAccount(4, 'Work Account', 'Notes')).success).toBe(true);
      expect(prisma.account.update).toHaveBeenCalledTimes(1);
      expect(revalidatePath).toHaveBeenCalledTimes(4);

      vi.mocked(revalidatePath).mockImplementationOnce(() => {
        throw new Error('PRIVATE_DELETE_TOKEN');
      });
      expect((await deleteAccount(4)).success).toBe(true);
      expect(prisma.account.delete).toHaveBeenCalledTimes(1);
      expect(revalidatePath).toHaveBeenCalledTimes(8);
      expect(JSON.stringify(warning.mock.calls)).not.toMatch(/PRIVATE_PASSWORD|PRIVATE_DELETE_TOKEN/);
    } finally {
      warning.mockRestore();
    }
  });

  it('does not duplicate the rate audit when a committed rate change cannot revalidate the cache', async () => {
    const auditCreate = vi.fn().mockResolvedValue({ id: 20 });
    const upsert = vi.fn().mockResolvedValue({
      id: 11, interpreterId: 2, accountId: 4, tariffPerHour: 32,
    });
    vi.mocked(prisma.$transaction).mockImplementationOnce(async callback =>
      callback({
        interpreterAccountRate: {
          findUnique: vi.fn().mockResolvedValue({ tariffPerHour: 30 }),
          upsert,
        },
        payrateAuditLog: { create: auditCreate },
      } as never) as never,
    );
    const warning = failCacheWithPrivateValue();
    try {
      expect((await setInterpreterAccountRate(2, 4, 32)).success).toBe(true);
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(auditCreate).toHaveBeenCalledTimes(1);
      expect(revalidatePath).toHaveBeenCalledWith('/admin/payrates');
      expect(JSON.stringify(warning.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally {
      warning.mockRestore();
    }
  });

  it('reports successful deletion of a rate even when its cache refresh fails', async () => {
    const warning = failCacheWithPrivateValue();
    try {
      expect((await deleteInterpreterAccountRate(2, 4)).success).toBe(true);
      expect(prisma.interpreterAccountRate.delete).toHaveBeenCalledTimes(1);
      expect(revalidatePath).toHaveBeenCalledTimes(1);
    } finally {
      warning.mockRestore();
    }
  });

  it('does not expose database credentials in account-fetch or rate mutation errors', async () => {
    const privateError = new Error('postgresql://svc:PRIVATE_PASSWORD@db.internal.invalid/payrates');
    vi.mocked(prisma.account.findMany).mockRejectedValueOnce(privateError);
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(privateError);
    vi.mocked(prisma.interpreterAccountRate.delete).mockRejectedValueOnce(privateError);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect((await getAccounts()).success).toBe(false);
      expect((await setInterpreterAccountRate(2, 4, 32)).success).toBe(false);
      expect((await deleteInterpreterAccountRate(2, 4)).success).toBe(false);
      expect(errorLog).toHaveBeenCalledWith('[ACCOUNT_RATES] Fetch failed:', 'Error');
      expect(errorLog).toHaveBeenCalledWith('[ACCOUNT_RATES] Rate update failed:', 'Error');
      expect(errorLog).toHaveBeenCalledWith('[ACCOUNT_RATES] Rate delete failed:', 'Error');
      expect(JSON.stringify(errorLog.mock.calls)).not.toMatch(/PRIVATE_PASSWORD|db\.internal\.invalid|postgresql:/);
    } finally {
      errorLog.mockRestore();
    }
  });

  it('rejects non-admin callers without accessing or modifying accounts or payrates', async () => {
    vi.mocked(validateAction).mockResolvedValue({ error: 'Forbidden', code: 'FORBIDDEN' } as never);
    expect((await createAccount('Test', '', 3)).success).toBe(false);
    expect((await setInterpreterAccountRate(2, 4, 32)).success).toBe(false);
    expect(prisma.account.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
