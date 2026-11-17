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
import { revalidatePath } from 'next/cache';
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

  it('reports company creation success when cache refresh fails after commit', async () => {
    vi.mocked(prisma.company.create).mockResolvedValueOnce({ id: 8 } as never);
    vi.mocked(revalidatePath).mockImplementationOnce(() => {
      throw new Error('PRIVATE_DB_CONNECTION_STRING');
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const form = new FormData();
      form.set('name', 'Language Services');
      expect(await createCompany(form)).toEqual({ success: true });
      expect(prisma.company.create).toHaveBeenCalledTimes(1);
      expect(revalidatePath).toHaveBeenCalledWith('/admin/companies');
      expect(warning).toHaveBeenCalledWith('[COMPANIES] Saved but cache refresh failed', 'Error');
      expect(JSON.stringify(warning.mock.calls)).not.toMatch(/PRIVATE_DB_CONNECTION_STRING/);
    } finally {
      warning.mockRestore();
    }
  });

  it('keeps account assignment successful and revalidates remaining pages if one refresh throws', async () => {
    vi.mocked(prisma.account.update).mockResolvedValueOnce({ id: 12, companyId: 3 } as never);
    vi.mocked(revalidatePath).mockImplementationOnce(() => {
      throw new Error('SECRET_SERVICE_HOST');
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const form = new FormData();
      form.set('accountId', '12');
      form.set('companyId', '3');
      expect(await assignAccountToCompany(form)).toEqual({ success: true });
      expect(prisma.account.update).toHaveBeenCalledTimes(1);
      expect(revalidatePath).toHaveBeenCalledTimes(2);
      expect(revalidatePath).toHaveBeenNthCalledWith(1, '/admin/companies');
      expect(revalidatePath).toHaveBeenNthCalledWith(2, '/admin/accounts');
      expect(warning).toHaveBeenCalledWith('[COMPANIES] Saved but cache refresh failed', 'Error');
      expect(JSON.stringify(warning.mock.calls)).not.toMatch(/SECRET_SERVICE_HOST/);
    } finally {
      warning.mockRestore();
    }
  });

  it('does not invalidate caches after a failed company write', async () => {
    vi.mocked(prisma.company.create).mockRejectedValueOnce(new Error('DB write failed'));
    const logging = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const form = new FormData();
      form.set('name', 'Language Services');
      expect(await createCompany(form)).toEqual({ success: false, error: 'No se pudo registrar la compañía.' });
      expect(revalidatePath).not.toHaveBeenCalled();
    } finally {
      logging.mockRestore();
    }
  });

  it('rejects non-admin users before database writes', async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue({ role: 'interpreter' } as never);
    const data = new FormData();
    data.set('name', 'Language Services');
    expect(await createCompany(data)).toEqual({ success: false, error: 'No autorizado.' });
    expect(prisma.company.create).not.toHaveBeenCalled();
  });
  it('returns success when company creation committed but cache refresh fails', async () => {
    vi.mocked(prisma.company.create).mockResolvedValueOnce({ id: 11 } as never);
    vi.mocked(revalidatePath).mockImplementationOnce(() => {
      throw new Error('SECRET_CACHE_DATA');
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const data = new FormData();
      data.set('name', 'Language Services');
      expect(await createCompany(data)).toEqual({ success: true });
      expect(prisma.company.create).toHaveBeenCalledTimes(1);
      expect(revalidatePath).toHaveBeenCalledWith('/admin/companies');
      expect(warning).toHaveBeenCalledWith('[COMPANIES] Cache refresh failed', 'Error');
      expect(JSON.stringify(warning.mock.calls)).not.toContain('SECRET_CACHE_DATA');
    } finally { warning.mockRestore(); }
  });

  it('continues refreshing accounts after a committed assignment when one cache path fails', async () => {
    vi.mocked(prisma.account.update).mockResolvedValueOnce({ id: 12 } as never);
    vi.mocked(revalidatePath).mockImplementationOnce(() => {
      throw new Error('SECRET_REFRESH_TOKEN');
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const data = new FormData();
      data.set('accountId', '12');
      data.set('companyId', '3');
      expect(await assignAccountToCompany(data)).toEqual({ success: true });
      expect(prisma.account.update).toHaveBeenCalledTimes(1);
      expect(prisma.account.update).toHaveBeenCalledWith({
        where: { id: 12 },
        data: { companyId: 3 },
      });
      expect(revalidatePath).toHaveBeenNthCalledWith(1, '/admin/companies');
      expect(revalidatePath).toHaveBeenNthCalledWith(2, '/admin/accounts');
      expect(warning).toHaveBeenCalledWith('[COMPANIES] Cache refresh failed', 'Error');
      expect(JSON.stringify(warning.mock.calls)).not.toContain('SECRET_REFRESH_TOKEN');
    } finally { warning.mockRestore(); }
  });

  it('does not run cache refresh after a failed database write', async () => {
    vi.mocked(prisma.company.create).mockRejectedValueOnce(new Error('Synthetic DB failure'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const data = new FormData();
      data.set('name', 'Language Services');
      expect(await createCompany(data)).toEqual({ success: false, error: 'No se pudo registrar la compañía.' });
      expect(revalidatePath).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

});
