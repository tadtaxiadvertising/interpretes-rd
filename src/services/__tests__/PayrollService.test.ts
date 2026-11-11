import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateFullPayroll, recalculateWithVerifiedMinutes } from '../PayrollService';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    interpreter: { findUnique: vi.fn() },
    productionLog: { findMany: vi.fn() },
    systemConfig: { findMany: vi.fn() },
    qAScore: { findMany: vi.fn() },
    payrollRecord: { findFirst: vi.fn(), findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ default: prismaMock }));

describe('PayrollService verified-minute recalculation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.interpreter.findUnique.mockResolvedValue({
      id: 1,
      name: 'Test Interpreter',
      tariffPerMinute: { toString: () => '0.5' },
      metodoPago: 'PayPal',
      monthlyGoal: 2000,
    });
    prismaMock.productionLog.findMany.mockResolvedValue([]);
    prismaMock.systemConfig.findMany.mockResolvedValue([]);
    prismaMock.qAScore.findMany.mockResolvedValue([
      { totalScore: { toString: () => '95' }, criticalError: false },
    ]);
    prismaMock.payrollRecord.findFirst.mockResolvedValue(null);
    prismaMock.payrollRecord.findUnique.mockResolvedValue({
      interpreterId: 1,
      periodStart: new Date('2026-01-01T00:00:00.000Z'),
      periodEnd: new Date('2026-01-15T23:59:59.999Z'),
    });
  });

  it('recalculates QA bonus, fees and net pay from the verified-minute override', async () => {
    const result = await recalculateWithVerifiedMinutes('payroll-1', 1200);

    expect(result).toEqual({
      grossTotal: 600,
      qualityBonus: 30,
      incentivesTotal: 0,
      penalidades: 0,
      transferDeduction: 30,
      netTotal: 600,
    });
    expect(prismaMock.productionLog.findMany).not.toHaveBeenCalled();
    expect(prismaMock.qAScore.findMany).toHaveBeenCalledWith({
      where: {
        interpreterId: 1,
        auditDate: {
          gte: new Date('2026-01-01T00:00:00.000Z'),
          lte: new Date('2026-01-15T23:59:59.999Z'),
        },
      },
      select: { totalScore: true, criticalError: true },
    });
  });

  it('uses verified Q1 minutes when calculating Q2 goal attainment', async () => {
    prismaMock.payrollRecord.findUnique.mockResolvedValue({
      interpreterId: 1,
      periodStart: new Date('2026-01-16T00:00:00.000Z'),
      periodEnd: new Date('2026-01-31T23:59:59.999Z'),
    });
    prismaMock.interpreter.findUnique.mockResolvedValue({
      id: 1,
      name: 'Test Interpreter',
      tariffPerMinute: { toString: () => '0.5' },
      metodoPago: 'Bank Transfer',
      monthlyGoal: 2000,
    });
    prismaMock.payrollRecord.findFirst.mockResolvedValue({
      totalMinutes: 500,
      verifiedMinutes: 1000,
    });
    prismaMock.qAScore.findMany.mockResolvedValue([]);

    const result = await recalculateWithVerifiedMinutes('payroll-2', 1000);

    expect(result).toMatchObject({
      grossTotal: 500,
      qualityBonus: 0,
      penalidades: 0,
      transferDeduction: 0,
      netTotal: 500,
    });
    expect(prismaMock.payrollRecord.findFirst).toHaveBeenCalledWith({
      where: {
        interpreterId: 1,
        periodStart: { gte: new Date('2026-01-01T00:00:00.000Z') },
        periodEnd: { lte: new Date('2026-01-15T00:00:00.000Z') },
      },
      select: { totalMinutes: true, verifiedMinutes: true },
    });
  });

  it('rejects invalid verified-minute overrides before changing financial totals', async () => {
    await expect(recalculateWithVerifiedMinutes('payroll-3', -1)).rejects.toThrow(
      'Verified minutes must be an integer between 0 and 100000.',
    );
  });
});
