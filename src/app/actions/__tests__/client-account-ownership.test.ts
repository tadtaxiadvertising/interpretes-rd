import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/actions/auth', () => ({
  getCurrentProfile: vi.fn(),
}));

vi.mock('@/lib/auth/actions', () => ({
  validateAction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    client: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    account: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { getCurrentProfile } from '@/app/actions/auth';
import { validateAction } from '@/lib/auth/actions';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { createClient, assignAccountToClient } from '../admin-clients';
import { createOperationalAccount } from '../admin-accounts';

function makeForm(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

const adminProfile = { id: 'admin-1', role: 'admin' };

describe('client ownership actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getCurrentProfile as any).mockResolvedValue(adminProfile);
    (validateAction as any).mockResolvedValue({ user: { userId: 'admin-1', role: 'admin' } });
  });

  it('rejects client and account mutations for non-admin actors', async () => {
    (getCurrentProfile as any).mockResolvedValue(null);
    (validateAction as any).mockResolvedValue({ error: 'Unauthorized', code: 'UNAUTHORIZED' });

    const clientResult = await createClient(makeForm({ name: 'Client A' }));
    const assignmentResult = await assignAccountToClient(makeForm({ accountId: '42', clientId: '3' }));
    const accountResult = await createOperationalAccount(makeForm({
      clientId: '3', name: 'Support Account', description: '',
    }));

    expect(clientResult.success).toBe(false);
    expect(assignmentResult.success).toBe(false);
    expect(accountResult.success).toBe(false);
    expect(prisma.client.create).not.toHaveBeenCalled();
    expect(prisma.account.create).not.toHaveBeenCalled();
    expect(prisma.account.updateMany).not.toHaveBeenCalled();
  });

  it('creates a client and revalidates client/account directories', async () => {
    const result = await createClient(makeForm({
      name: 'Client A',
      legalName: 'Client A LLC',
      contactName: 'Operations',
      contactEmail: 'ops@example.com',
      phone: '+1 555 0100',
      notes: 'Test client',
    }));

    expect(result.success).toBe(true);
    expect(prisma.client.create).toHaveBeenCalledWith({
      data: {
        name: 'Client A',
        legalName: 'Client A LLC',
        contactName: 'Operations',
        contactEmail: 'ops@example.com',
        phone: '+1 555 0100',
        notes: 'Test client',
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/clients');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/accounts');
  });

  it('assigns only an unowned legacy account to an active client', async () => {
    (prisma.client.findFirst as any).mockResolvedValue({ id: 3 });
    (prisma.account.updateMany as any).mockResolvedValue({ count: 1 });

    const result = await assignAccountToClient(makeForm({ accountId: '42', clientId: '3' }));

    expect(result.success).toBe(true);
    expect(prisma.client.findFirst).toHaveBeenCalledWith({
      where: { id: 3, active: true },
      select: { id: true },
    });
    expect(prisma.account.updateMany).toHaveBeenCalledWith({
      where: { id: 42, clientId: null },
      data: { clientId: 3 },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/reconciliation');
  });

  it('does not overwrite an account that already has an owner', async () => {
    (prisma.client.findFirst as any).mockResolvedValue({ id: 3 });
    (prisma.account.updateMany as any).mockResolvedValue({ count: 0 });

    const result = await assignAccountToClient(makeForm({ accountId: '42', clientId: '3' }));

    expect(result.success).toBe(false);
    expect(prisma.account.updateMany).toHaveBeenCalledWith({
      where: { id: 42, clientId: null },
      data: { clientId: 3 },
    });
  });

  it('requires an active client when creating a new operational account', async () => {
    (prisma.client.findFirst as any).mockResolvedValue(null);

    const result = await createOperationalAccount(makeForm({
      clientId: '3', name: 'Support Account', description: '',
    }));

    expect(result.success).toBe(false);
    expect(prisma.account.create).not.toHaveBeenCalled();
  });

  it('creates an operational account with the selected clientId', async () => {
    (prisma.client.findFirst as any).mockResolvedValue({ id: 3 });
    (prisma.account.create as any).mockResolvedValue({ id: 42 });

    const result = await createOperationalAccount(makeForm({
      clientId: '3', name: ' Support Account ', description: '  Support queue  ',
    }));

    expect(result.success).toBe(true);
    expect(prisma.account.create).toHaveBeenCalledWith({
      data: { clientId: 3, name: 'Support Account', description: 'Support queue' },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/accounts');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/clients');
  });
});
