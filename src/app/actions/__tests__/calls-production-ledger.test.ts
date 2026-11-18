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
import { revalidateInterpreterProfileRecords } from '@/lib/cache/revalidate-interpreter';

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
        isSettled: false,
        payrollRecordId: null,
      }),
    },
    payrollRecord: { findFirst: vi.fn().mockResolvedValue(null) },
    interpreter: { update: vi.fn().mockResolvedValue({ id: 7 }) },
    interpreterStatusLog: { create: vi.fn().mockResolvedValue({ id: 1 }) },
    callProductionEntry: {
      create: vi.fn().mockResolvedValue({ callSessionId: 99 }),
    },
    productionLog: {
      findFirst: vi.fn().mockResolvedValue({
        id: 22,
        interpretedMinutes: 10,
        callsAttended: 3,
        isSettled: false,
        payrollRecordId: null,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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
        productionLogId: 22,
      }),
    });
    expect(tx.productionLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 22, isSettled: false },
      data: { interpretedMinutes: 12, callsAttended: 4 },
    }));
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });

  it('does not write production again when another request already ended the session', async () => {
    const tx = transactionMocks();
    tx.callSession.updateMany.mockResolvedValue({ count: 0 });

    const result = await endCall(99);

    expect(result.success).toBe(true);
    expect(tx.callProductionEntry.create).not.toHaveBeenCalled();
    expect(tx.productionLog.updateMany).not.toHaveBeenCalled();
    expect(tx.payrollRecord.findFirst).not.toHaveBeenCalled();
    expect(tx.productionLog.create).not.toHaveBeenCalled();
  });

  it('refuses finalized payroll statuses before writing interpreter status or ledger', async () => {
    const tx = transactionMocks();
    tx.payrollRecord.findFirst.mockResolvedValueOnce({ id: 'approved' });

    const result = await endCall(99);

    expect(result).toMatchObject({ success: false, code: 'CONFLICT' });
    expect(tx.payrollRecord.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            interpreterId: 7,
            periodStart: { lte: expect.any(Date) },
            periodEnd: { gte: expect.any(Date) },
          },
        ],
        AND: [{
          OR: [
            { paidAt: { not: null } },
            { status: { notIn: ['PENDING', 'Pendiente'] } },
            { status: null },
          ],
        }],
      },
      select: { id: true },
    });
    expect(tx.interpreter.update).not.toHaveBeenCalled();
    expect(tx.interpreterStatusLog.create).not.toHaveBeenCalled();
    expect(tx.productionLog.updateMany).not.toHaveBeenCalled();
    expect(tx.callProductionEntry.create).not.toHaveBeenCalled();
    expect(revalidateInterpreterProfileRecords).not.toHaveBeenCalled();
  });

  it('rejects a settled day and also a settled call session', async () => {
    const tx = transactionMocks();
    tx.productionLog.findFirst.mockResolvedValueOnce({
      id: 22, isSettled: true, interpretedMinutes: 10, callsAttended: 3,
    });
    expect((await endCall(99)).code).toBe('CONFLICT');
    expect(tx.payrollRecord.findFirst).not.toHaveBeenCalled();
    expect(tx.callProductionEntry.create).not.toHaveBeenCalled();

    tx.callSession.findFirst.mockResolvedValueOnce({
      startedAt: new Date('2026-11-10T15:00:00Z'),
      durationSeconds: 125, callCost: 12.5, isSettled: true,
    });
    expect((await endCall(99)).code).toBe('CONFLICT');
    expect(tx.callProductionEntry.create).not.toHaveBeenCalled();
  });

  it('refuses linked finalized payrolls even outside the operational date', async () => {
    const tx = transactionMocks();
    tx.callSession.findFirst.mockResolvedValueOnce({
      startedAt: new Date('2026-11-10T15:00:00Z'),
      durationSeconds: 125, callCost: 12.5,
      isSettled: false, payrollRecordId: 'linked-session',
    });
    tx.productionLog.findFirst.mockResolvedValueOnce({
      id: 22, isSettled: false, payrollRecordId: 'linked-production',
      interpretedMinutes: 10, callsAttended: 3,
    });
    tx.payrollRecord.findFirst.mockResolvedValueOnce({ id: 'linked-production' });
    expect((await endCall(99)).code).toBe('CONFLICT');
    expect(tx.payrollRecord.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { id: 'linked-production' },
          { id: 'linked-session' },
        ]),
      }),
    }));
    expect(tx.callProductionEntry.create).not.toHaveBeenCalled();
  });

  it('blocks a concurrent settlement between checking and updating production', async () => {
    const tx = transactionMocks();
    tx.productionLog.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await endCall(99)).code).toBe('CONFLICT');
    expect(tx.callProductionEntry.create).not.toHaveBeenCalled();
  });

  it('rejects a locked period for a sub-minute call, without creating a daily aggregate', async () => {
    const tx = transactionMocks();
    tx.callSession.findFirst.mockResolvedValueOnce({
      startedAt: new Date('2026-11-10T15:00:00Z'),
      durationSeconds: 25, callCost: 2.5, isSettled: false,
    });
    tx.productionLog.findFirst.mockResolvedValueOnce(null);
    tx.payrollRecord.findFirst.mockResolvedValueOnce({ id: 'paid' });
    expect((await endCall(99)).code).toBe('CONFLICT');
    expect(tx.productionLog.create).not.toHaveBeenCalled();
    expect(tx.callProductionEntry.create).not.toHaveBeenCalled();
  });

  it('reports serialization conflicts without leaking database details', async () => {
    transactionMocks();
    (prisma.$transaction as any).mockRejectedValueOnce({ code: 'P2034' });
    const result = await endCall(99);
    expect(result).toMatchObject({ success: false, code: 'CONFLICT' });
  });

  it('does not report failure after commit when cache refresh fails', async () => {
    transactionMocks();
    (revalidateInterpreterProfileRecords as any).mockImplementationOnce(() => {
      throw new Error('PRIVATE_DB_PASSWORD');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect((await endCall(99)).success).toBe(true);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_DB_PASSWORD');
      expect(warn).toHaveBeenCalledWith('Call ended; cache refresh failed:', 'Error');
    } finally { warn.mockRestore(); }
  });

  it('returns a failure when the ledger insert fails inside the transaction', async () => {
    const tx = transactionMocks();
    tx.callProductionEntry.create.mockRejectedValue(new Error('ledger unavailable'));

    const result = await endCall(99);

    expect(result.success).toBe(false);
    // The daily aggregate write is attempted before the ledger insert. The
    // rejected Prisma transaction is what guarantees that this write rolls
    // back; this unit mock cannot assert database rollback semantics.
    expect(tx.productionLog.updateMany).toHaveBeenCalledOnce();
    expect(tx.productionLog.create).not.toHaveBeenCalled();
  });
});
