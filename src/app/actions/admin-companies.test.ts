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

  it('rejects non-admin users before database writes', async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue({ role: 'interpreter' } as never);
    const data = new FormData();
    data.set('name', 'Language Services');
    expect(await createCompany(data)).toEqual({ success: false, error: 'No autorizado.' });
    expect(prisma.company.create).not.toHaveBeenCalled();
  });
});
