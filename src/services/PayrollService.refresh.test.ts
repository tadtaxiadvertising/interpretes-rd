// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));

import { refreshPayrollRecord } from './PayrollService';

function fixture(updateCount: number) {
  const tx = {
    payrollRecord: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'pay-1', periodStart: new Date('2026-11-01T00:00:00Z'),
        periodEnd: new Date('2026-11-15T00:00:00Z'), status: 'PENDING',
      }),
      updateMany: vi.fn().mockResolvedValue({ count: updateCount }),
    },
    interpreter: {
      findUnique: vi.fn().mockResolvedValue({
        id: 3, name: 'Synthetic Interpreter', tariffPerMinute: '1.50',
        metodoPago: 'Bank Transfer', monthlyGoal: 100,
      }),
    },
    productionLog: {
      findMany: vi.fn().mockResolvedValue([
        { interpretedMinutes: 60, verifiedMinutes: null },
      ]),
    },
    systemConfig: { findMany: vi.fn().mockResolvedValue([]) },
    qAScore: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return tx;
}

describe('refreshPayrollRecord conditional write safety', () => {
  const when = new Date('2026-11-12T00:00:00Z');

  it('updates only an existing pending and unpaid record', async () => {
    const tx = fixture(1);
    await expect(refreshPayrollRecord(3, when, tx as never)).resolves.toBeUndefined();
    expect(tx.payrollRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'pay-1',
        status: { in: ['Pendiente', 'PENDING'] },
        paidAt: null,
      },
      data: expect.objectContaining({
        totalMinutes: 60, verifiedMinutes: 60,
      }),
    });
  });

  it('throws if approval or payment races with the pending update', async () => {
    const tx = fixture(0);
    await expect(refreshPayrollRecord(3, when, tx as never)).rejects.toThrow(
      'Payroll changed during recalculation',
    );
    expect(tx.payrollRecord.updateMany).toHaveBeenCalledOnce();
    // If this is called within the serializable reconciliation transaction,
    // Prisma rolls back the changed verified minutes on this rejection.
  });

  it('does not create payroll if no matching pending record exists', async () => {
    const tx = fixture(0);
    tx.payrollRecord.findFirst.mockResolvedValueOnce(null);
    await expect(refreshPayrollRecord(3, when, tx as never)).resolves.toBeUndefined();
    expect(tx.payrollRecord.updateMany).not.toHaveBeenCalled();
  });
});
