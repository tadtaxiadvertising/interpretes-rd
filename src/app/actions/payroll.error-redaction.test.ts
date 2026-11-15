import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  validateAction: vi.fn(),
  interpreterFindMany: vi.fn(),
  payrollFindFirst: vi.fn(),
  createPayrollRecord: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/actions', () => ({ validateAction: m.validateAction }));
vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: { findMany: m.interpreterFindMany },
    payrollRecord: { findFirst: m.payrollFindFirst },
  },
}));
vi.mock('@/lib/payroll', () => ({
  createPayrollRecord: m.createPayrollRecord,
}));
vi.mock('@/services/PayrollService', () => ({
  refreshPayrollRecord: vi.fn(),
}));
vi.mock('next/cache', () => ({
  revalidatePath: m.revalidatePath,
}));

import { generatePayrollPeriod } from './payroll';

describe('generatePayrollPeriod safe error boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.validateAction.mockResolvedValue({ user: { userId: 'admin-1', role: 'admin' } });
    m.interpreterFindMany.mockResolvedValue([{ id: 7 }]);
    m.payrollFindFirst.mockResolvedValue(null);
    m.createPayrollRecord.mockResolvedValue(undefined);
  });

  it('refuses non-admin actions before any payroll query', async () => {
    m.validateAction.mockResolvedValueOnce({ error: 'Forbidden', code: 'FORBIDDEN' });
    const res = await generatePayrollPeriod();
    expect(res.success).toBe(false);
    expect(m.interpreterFindMany).not.toHaveBeenCalled();
    expect(m.payrollFindFirst).not.toHaveBeenCalled();
    expect(m.createPayrollRecord).not.toHaveBeenCalled();
  });

  it('redacts database connection information from errors and logs', async () => {
    m.interpreterFindMany.mockRejectedValueOnce(
      new Error('postgresql://user:PRIVATE_SECRET@internal-db.invalid/payroll'),
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await generatePayrollPeriod();
      expect(res).toEqual({
        success: false,
        error: 'Failed to generate payroll',
        code: 'INTERNAL_ERROR',
      });
      expect(JSON.stringify(res)).not.toMatch(/PRIVATE_SECRET|internal-db\.invalid|postgresql:/);
      expect(error).toHaveBeenCalledWith('Failed to generate payroll:', 'Error');
      expect(JSON.stringify(error.mock.calls)).not.toMatch(/PRIVATE_SECRET|internal-db\.invalid|postgresql:/);
      expect(m.revalidatePath).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it('preserves useful partial-failure counts while redacting interpreter-specific database exceptions', async () => {
    m.interpreterFindMany.mockResolvedValue([{ id: 7 }, { id: 9 }]);
    m.createPayrollRecord.mockRejectedValueOnce(
      new Error('PRIVATE_SECRET connection at internal-db.invalid'),
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await generatePayrollPeriod();
      expect(res).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
      expect(res.error).toContain('1 registros creados y 1 fallidos');
      expect(JSON.stringify(res)).not.toContain('PRIVATE_SECRET');
      expect(error).toHaveBeenCalledWith('[PAYROLL] Generation failed:', 'Error');
      expect(JSON.stringify(error.mock.calls)).not.toMatch(/PRIVATE_SECRET|internal-db\.invalid/);
      expect(m.revalidatePath).toHaveBeenCalledWith('/payroll');
    } finally {
      error.mockRestore();
    }
  });

  it('returns a validation error without querying payroll when a date is invalid', async () => {
    const res = await generatePayrollPeriod(new Date(Number.NaN));
    expect(res).toEqual({
      success: false,
      error: 'Invalid payroll period input',
      code: 'VALIDATION_ERROR',
    });
    expect(m.interpreterFindMany).not.toHaveBeenCalled();
  });

  it('keeps expected P2002 unique races idempotent and does not log them', async () => {
    m.createPayrollRecord.mockRejectedValueOnce({ code: 'P2002' });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await generatePayrollPeriod();
      expect(res.success).toBe(true);
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
