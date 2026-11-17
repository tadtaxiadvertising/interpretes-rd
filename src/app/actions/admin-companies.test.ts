// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/actions/auth', () => ({
  getCurrentProfile: vi.fn().mockResolvedValue({ role: 'admin' }),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    company: { create: vi.fn() },
    account: { update: vi.fn() },
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getCurrentProfile } from '@/app/actions/auth';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { createCompany, assignAccountToCompany } from './admin-companies';

describe('admin company actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentProfile).mockResolvedValue({ role: 'admin' } as never);
  });

  it('redacts database details when company creation fails', async () => {
    vi.mocked(prisma.company.create).mockRejectedValueOnce(
      new Error('postgresql://admin:PRIVATE_PASSWORD@db.internal/companies'),
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const data = new FormData();
      data.set('name', 'Language Services');
      const result = await createCompany(data);
      expect(result).toEqual({ success: false, error: 'No se pudo registrar la compañía.' });
      expect(spy).toHaveBeenCalledWith('[COMPANIES] Create failed', 'Error');
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(/PRIVATE_PASSWORD|db\.internal|postgresql:/);
    } finally {
      spy.mockRestore();
    }
  });

  it('redacts database details when account assignment fails', async () => {
    vi.mocked(prisma.account.update).mockRejectedValueOnce(
      new Error('postgresql://admin:PRIVATE_PASSWORD@db.internal/accounts'),
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const data = new FormData();
      data.set('accountId', '12');
      data.set('companyId', '3');
      const result = await assignAccountToCompany(data);
      expect(result).toEqual({ success: false, error: 'No se pudo vincular la cuenta.' });
      expect(spy).toHaveBeenCalledWith('[COMPANIES] Assign failed', 'Error');
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(/PRIVATE_PASSWORD|db\.internal|postgresql:/);
    } finally {
      spy.mockRestore();
    }
  });

  it('does not report duplicate-prone failure when company creation commits before cache invalidation fails', async () => {
    vi.mocked(prisma.company.create).mockResolvedValueOnce({ id: 3 } as never);
    vi.mocked(revalidatePath).mockImplementationOnce(() => {
      throw new Error('PRIVATE_CACHE_TOKEN');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const data = new FormData();
      data.set('name', 'Language Services');
      expect(await createCompany(data)).toEqual({ success: true });
      expect(prisma.company.create).toHaveBeenCalledTimes(1);
      expect(revalidatePath).toHaveBeenCalledWith('/admin/companies');
      expect(warn).toHaveBeenCalledWith('[COMPANIES] Saved but cache refresh failed:', 'Error');
      expect(error).not.toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_CACHE_TOKEN');
    } finally { warn.mockRestore(); error.mockRestore(); }
  });

  it('keeps committed account assignment successful and attempts both cache paths independently', async () => {
    vi.mocked(prisma.account.update).mockResolvedValueOnce({ id: 12, companyId: 3 } as never);
    vi.mocked(revalidatePath).mockImplementationOnce(() => {
      throw new Error('PRIVATE_CACHE_TOKEN');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const data = new FormData();
      data.set('accountId', '12');
      data.set('companyId', '3');
      expect(await assignAccountToCompany(data)).toEqual({ success: true });
      expect(prisma.account.update).toHaveBeenCalledTimes(1);
      expect(prisma.account.update).toHaveBeenCalledWith({
        where: { id: 12 }, data: { companyId: 3 },
      });
      expect(revalidatePath).toHaveBeenNthCalledWith(1, '/admin/companies');
      expect(revalidatePath).toHaveBeenNthCalledWith(2, '/admin/accounts');
      expect(warn).toHaveBeenCalledWith('[COMPANIES] Assigned but cache refresh failed:', 'Error');
      expect(error).not.toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_CACHE_TOKEN');
    } finally { warn.mockRestore(); error.mockRestore(); }
  });

  it('rejects non-admin users before database writes', async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue({ role: 'interpreter' } as never);
    const data = new FormData();
    data.set('name', 'Language Services');
    expect(await createCompany(data)).toEqual({ success: false, error: 'No autorizado.' });
    expect(prisma.company.create).not.toHaveBeenCalled();
  });
});
