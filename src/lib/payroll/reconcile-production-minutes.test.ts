// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: { $transaction: mocks.transaction },
}));
vi.mock('@/services/PayrollService', () => ({
  refreshPayrollRecord: mocks.refresh,
}));

import { reconcileProductionMinutes } from './reconcile-production-minutes';

const log = {
  id: 73,
  interpreterId: 11,
  date: new Date('2026-11-17T00:00:00.000Z'),
  isSettled: false,
  payrollRecordId: null,
};

function txMock() {
  const tx = {
    productionLog: {
      findUnique: vi.fn()
        .mockResolvedValueOnce(log)
        .mockResolvedValueOnce({ ...log, verifiedMinutes: 47 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    payrollRecord: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  mocks.transaction.mockImplementation(
    async (work: (tx: typeof tx) => Promise<unknown>) => work(tx),
  );
  return tx;
}

describe('shared payroll reconciliation uses one serializable transaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refresh.mockResolvedValue(undefined);
  });

  it('does not write for a missing log', async () => {
    const tx = txMock();
    tx.productionLog.findUnique.mockReset().mockResolvedValue(null);
    expect(await reconcileProductionMinutes(73, 47)).toEqual({ kind: 'NOT_FOUND' });
    expect(tx.payrollRecord.findFirst).not.toHaveBeenCalled();
    expect(tx.productionLog.updateMany).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('rejects a settled log before checking or changing payroll', async () => {
    const tx = txMock();
    tx.productionLog.findUnique.mockReset().mockResolvedValue({ ...log, isSettled: true });
    expect(await reconcileProductionMinutes(73, 47)).toEqual({ kind: 'SETTLED' });
    expect(tx.payrollRecord.findFirst).not.toHaveBeenCalled();
    expect(tx.productionLog.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an orphaned log without interpreter ownership', async () => {
    const tx = txMock();
    tx.productionLog.findUnique.mockReset().mockResolvedValue({ ...log, interpreterId: null });
    expect(await reconcileProductionMinutes(73, 47)).toEqual({ kind: 'INVALID_LOG' });
    expect(tx.productionLog.updateMany).not.toHaveBeenCalled();
  });

  it('rejects payroll locked by paidAt, approval, or non-pending legacy states', async () => {
    const tx = txMock();
    tx.payrollRecord.findFirst.mockResolvedValueOnce({ id: 'pay-9' });
    expect(await reconcileProductionMinutes(73, 47)).toEqual({ kind: 'LOCKED_PAYROLL' });
    expect(tx.productionLog.updateMany).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(tx.payrollRecord.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        OR: [expect.objectContaining({ interpreterId: 11 })],
        AND: [{
          OR: [
            { paidAt: { not: null } },
            { status: { notIn: ['PENDING', 'Pendiente'] } },
            { status: null },
          ],
        }],
      }),
      select: { id: true },
    });
  });

  it('guards direct payroll links even if the dates are inconsistent', async () => {
    const tx = txMock();
    tx.productionLog.findUnique.mockReset().mockResolvedValueOnce({
      ...log, payrollRecordId: 'pay-linked',
    });
    tx.payrollRecord.findFirst.mockResolvedValueOnce({ id: 'pay-linked' });
    expect(await reconcileProductionMinutes(73, 47)).toEqual({ kind: 'LOCKED_PAYROLL' });
    expect(tx.payrollRecord.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({
        OR: expect.arrayContaining([{ id: 'pay-linked' }]),
      }) }),
    );
    expect(tx.productionLog.updateMany).not.toHaveBeenCalled();
  });

  it('blocks a concurrent settled change when updateMany finds no editable row', async () => {
    const tx = txMock();
    tx.productionLog.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await reconcileProductionMinutes(73, 47)).toEqual({ kind: 'CONFLICT' });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('refreshes pending payroll with the same transaction client after a conditional write', async () => {
    const tx = txMock();
    const result = await reconcileProductionMinutes(73, 47);
    expect(result).toMatchObject({ kind: 'UPDATED', log: { id: 73, verifiedMinutes: 47 } });
    expect(tx.productionLog.updateMany).toHaveBeenCalledWith({
      where: { id: 73, isSettled: false },
      data: { verifiedMinutes: 47 },
    });
    expect(mocks.refresh).toHaveBeenCalledWith(11, log.date, tx);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('propagates refresh failures out of the transaction for database rollback', async () => {
    const tx = txMock();
    mocks.refresh.mockRejectedValueOnce(new Error('synthetic pending payroll failure'));
    await expect(reconcileProductionMinutes(73, 47)).rejects.toThrow(
      'synthetic pending payroll failure',
    );
    expect(tx.productionLog.updateMany).toHaveBeenCalledOnce();
    // This mocked transaction cannot prove rollback; PostgreSQL integration
    // must verify it during a full E2E run.
    expect(tx.productionLog.findUnique).toHaveBeenCalledTimes(1);
  });
});
