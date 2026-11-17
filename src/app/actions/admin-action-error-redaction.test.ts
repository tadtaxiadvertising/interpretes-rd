// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/actions/auth', () => ({
  getCurrentProfile: vi.fn().mockResolvedValue({ role: 'admin' }),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: vi.fn(),
    interpreterAccountAssignment: { updateMany: vi.fn() },
    client: { create: vi.fn(), findFirst: vi.fn() },
    account: { updateMany: vi.fn() },
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getCurrentProfile } from '@/app/actions/auth';
import prisma from '@/lib/prisma';
import {
  assignInterpreterToAccount,
  endInterpreterAccountAssignment,
} from './admin-account-assignments';
import { assignAccountToClient, createClient } from './admin-clients';

function makeForm(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

describe('admin action error log redaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentProfile).mockResolvedValue({ role: 'admin' } as never);
  });

  it('redacts provider details when creating an interpreter account assignment fails', async () => {
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(
      new Error('postgresql://admin:PRIVATE_SECRET@db.internal/assignments'),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await assignInterpreterToAccount(makeForm({
        accountId: '1', interpreterId: '2', startsAt: '2026-11-17', endsAt: '',
      }));
      expect(result.success).toBe(false);
      expect(log).toHaveBeenCalledWith('[ADMIN_ACCOUNTS] Assignment creation failed', 'Error');
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE_SECRET|db[.]internal|postgresql:/);
    } finally {
      log.mockRestore();
    }
  });

  it('redacts provider details when ending an interpreter account assignment fails', async () => {
    vi.mocked(prisma.interpreterAccountAssignment.updateMany).mockRejectedValueOnce(
      new Error('PRIVATE_SECRET at db.internal'),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await endInterpreterAccountAssignment(makeForm({
        assignmentId: '3', endsAt: '2026-11-17',
      }));
      expect(result.success).toBe(false);
      expect(log).toHaveBeenCalledWith('[ADMIN_ACCOUNTS] Assignment end failed', 'Error');
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE_SECRET|db[.]internal/);
    } finally {
      log.mockRestore();
    }
  });

  it('redacts provider details when creating a client fails', async () => {
    vi.mocked(prisma.client.create).mockRejectedValueOnce(
      new Error('postgresql://admin:PRIVATE_SECRET@db.internal/clients'),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await createClient(makeForm({
        name: 'Cliente de prueba', legalName: '', contactName: '',
        contactEmail: '', phone: '', notes: '',
      }));
      expect(result.success).toBe(false);
      expect(log).toHaveBeenCalledWith('[CLIENTS] Create failed', 'Error');
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE_SECRET|db[.]internal|postgresql:/);
    } finally {
      log.mockRestore();
    }
  });

  it('redacts provider details when assigning an account to a client fails', async () => {
    vi.mocked(prisma.client.findFirst).mockResolvedValueOnce({ id: 4 } as never);
    vi.mocked(prisma.account.updateMany).mockRejectedValueOnce(
      new Error('PRIVATE_SECRET at db.internal'),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await assignAccountToClient(makeForm({ accountId: '1', clientId: '4' }));
      expect(result.success).toBe(false);
      expect(log).toHaveBeenCalledWith('[CLIENTS] Account assignment failed', 'Error');
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE_SECRET|db[.]internal/);
    } finally {
      log.mockRestore();
    }
  });

  it('rejects non-admin callers before attempting client writes', async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue({ role: 'interpreter' } as never);
    const result = await createClient(makeForm({
      name: 'Cliente de prueba', legalName: '', contactName: '',
      contactEmail: '', phone: '', notes: '',
    }));
    expect(result.success).toBe(false);
    expect(prisma.client.create).not.toHaveBeenCalled();
  });
});
