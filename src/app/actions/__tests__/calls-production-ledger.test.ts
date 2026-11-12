import { beforeEach, describe, expect, it, vi } from 'vitest';
import { endCall } from '../calls';

vi.mock('@/lib/auth/actions', () => ({
  validateAction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/cache/revalidate-interpreter', () => ({
  revalidateInterpreterProfileRecords: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { validateAction } from '@/lib/auth/actions';
import prisma from '@/lib/prisma';

const auth = {
  user: { userId: 'profile-1', email: 'interpreter@example.com', role: 'interpreter', interpreterId: 7, profileId: 'profile-1' },
  profile: { userId: 'profile-1', email: 'interpreter@example.com', role: 'interpreter', interpreterId: 7, profileId: 'profile-1' },
};

function transactionMocks() {
  const tx = {
    callSession: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn().mockResolvedValue({
        durationSeconds: 125,
        callCost: 12.5,
        startedAt: new Date('2026-11-10T15:00:00.000Z'),
      }),
    },
    interpreter: { update: vi.fn().mockResolvedValue({ id: 7 }) },
    interpreterStatusLog: { create: vi.fn().mockResolvedValue({ id: 1 }) },
    callProductionEntry: {
      create: vi.fn().mockResolvedValue({ callSessionId: 99 }),
      update: vi.fn().mockResolvedValue({ callSessionId: 99 }),
    },
    productionLog: {
      findFirst: vi.fn().mockResolvedValue({
        id: 22,
        interpretedMinutes: 10,
        callsAttended: 3,
      }),
      update: vi.fn().mockResolvedValue({ id: 22 }),
      create: vi.fn(),
    },
  };

  (prisma.$transaction as any).mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
  return tx;
}

describe('endCall production ledger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (validateAction as any).mockResolvedValue(auth);
  });

  it('records one ledger row and increments the daily aggregate atomically', async () => {
    const tx = transactionMocks();

    const result = await endCall(99);

    expect(result.success).toBe(true);
    expect(tx.callProductionEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        callSessionId: 99,
        interpreterId: 7,
        interpretedMinutes: 2,
        callsAttended: 1,
      }),
    });
    expect(tx.productionLog.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 22 },
      data: { interpretedMinutes: 12, callsAttended: 4 },
    }));
    expect(tx.callProductionEntry.update).toHaveBeenCalledWith({
      where: { callSessionId: 99 },
      data: { productionLogId: 22 },
    });
  });

  it('does not write production again when another request already ended the session', async () => {
    const tx = transactionMocks();
    tx.callSession.updateMany.mockResolvedValue({ count: 0 });

    const result = await endCall(99);

    expect(result.success).toBe(true);
    expect(tx.callProductionEntry.create).not.toHaveBeenCalled();
    expect(tx.productionLog.update).not.toHaveBeenCalled();
    expect(tx.productionLog.create).not.toHaveBeenCalled();
  });

  it('rolls back the call transaction if the ledger insert fails', async () => {
    const tx = transactionMocks();
    tx.callProductionEntry.create.mockRejectedValue(new Error('ledger unavailable'));

    const result = await endCall(99);

    expect(result.success).toBe(false);
    expect(tx.productionLog.update).not.toHaveBeenCalled();
    expect(tx.productionLog.create).not.toHaveBeenCalled();
  });
});
