// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  createClient: vi.fn(),
  findClient: vi.fn(),
  assignAccount: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/app/actions/auth', () => ({ getCurrentProfile: mocks.getCurrentProfile }));
vi.mock('@/lib/prisma', () => ({
  default: {
    client: { create: mocks.createClient, findFirst: mocks.findClient },
    account: { updateMany: mocks.assignAccount },
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import { assignAccountToClient, createClient } from '../admin-clients';

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe('admin client post-commit behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentProfile.mockResolvedValue({ id: 'admin-test', role: 'admin' });
    mocks.findClient.mockResolvedValue({ id: 3 });
    mocks.assignAccount.mockResolvedValue({ count: 1 });
    mocks.createClient.mockResolvedValue({ id: 3 });
  });

  it('returns success after client INSERT even when the first cache refresh fails', async () => {
    mocks.revalidatePath.mockImplementationOnce(() => {
      throw new Error('PRIVATE_CACHE_TOKEN');
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await createClient(form({ name: 'Synthetic client' }))).toEqual({ success: true });
      expect(mocks.createClient).toHaveBeenCalledTimes(1);
      expect(mocks.revalidatePath).toHaveBeenNthCalledWith(1, '/admin/clients');
      expect(mocks.revalidatePath).toHaveBeenNthCalledWith(2, '/admin/accounts');
      expect(warning).toHaveBeenCalledWith('[CLIENTS] Saved but cache refresh failed', 'Error');
      expect(JSON.stringify(warning.mock.calls)).not.toContain('PRIVATE_CACHE_TOKEN');
    } finally { warning.mockRestore(); }
  });

  it('continues refreshing all views after a confirmed assignment despite cache errors', async () => {
    mocks.revalidatePath.mockImplementationOnce(() => {
      throw new Error('PRIVATE_ASSIGNMENT_SECRET');
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await assignAccountToClient(form({ accountId: '42', clientId: '3' }));
      expect(result).toEqual({ success: true });
      expect(mocks.assignAccount).toHaveBeenCalledTimes(1);
      expect(mocks.assignAccount).toHaveBeenCalledWith({
        where: { id: 42, clientId: null },
        data: { clientId: 3 },
      });
      const paths = [
        '/admin/clients', '/admin/accounts', '/admin/assignments',
        '/admin/reports', '/admin/reconciliation', '/admin/platforms',
      ];
      expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual(paths);
      expect(warning).toHaveBeenCalledWith('[CLIENTS] Saved but cache refresh failed', 'Error');
      expect(JSON.stringify(warning.mock.calls)).not.toContain('PRIVATE_ASSIGNMENT_SECRET');
    } finally { warning.mockRestore(); }
  });

  it('does not refresh caches or log credentials when client INSERT fails', async () => {
    mocks.createClient.mockRejectedValueOnce(new Error('postgresql://admin:PRIVATE_PASSWORD@db.internal/clients'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await createClient(form({ name: 'Synthetic client' })))
        .toEqual({ success: false, error: 'No se pudo registrar el cliente. Comprueba que no exista.' });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith('[CLIENTS] Create failed', 'Error');
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE_PASSWORD|db\.internal|postgresql:/);
    } finally { log.mockRestore(); }
  });

  it('does not refresh caches or log credentials when ownership UPDATE fails', async () => {
    mocks.assignAccount.mockRejectedValueOnce(new Error('postgresql://admin:PRIVATE_PASSWORD@db.internal/accounts'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await assignAccountToClient(form({ accountId: '42', clientId: '3' })))
        .toEqual({ success: false, error: 'No se pudo vincular la cuenta al cliente.' });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith('[CLIENTS] Account assignment failed', 'Error');
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE_PASSWORD|db\.internal|postgresql:/);
    } finally { log.mockRestore(); }
  });
});
