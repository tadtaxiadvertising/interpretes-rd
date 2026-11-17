// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  validate: vi.fn(),
  reconcile: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/payroll', () => ({ createPayrollRecord: vi.fn() }));
vi.mock('@/lib/payroll/reconcile-production-minutes', () => ({
  reconcileProductionMinutes: m.reconcile,
}));
vi.mock('@/lib/auth/actions', () => ({ validateAction: m.validate }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));

import { reconcileMinutes } from '../payroll';

describe('admin Server Action reuses guarded financial reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.validate.mockResolvedValue({ user: { userId: 'admin-1', role: 'admin' } });
  });

  it('rejects unauthorized callers without opening financial transactions', async () => {
    m.validate.mockResolvedValueOnce({ error: 'Forbidden', code: 'FORBIDDEN' });
    const result = await reconcileMinutes(73, 47);
    expect(result).toMatchObject({ success: false, code: 'FORBIDDEN' });
    expect(m.reconcile).not.toHaveBeenCalled();
    expect(m.revalidate).not.toHaveBeenCalled();
  });

  it('rejects invalid minutes without changing database state', async () => {
    const result = await reconcileMinutes(73, 100_001);
    expect(result).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    expect(m.reconcile).not.toHaveBeenCalled();
    expect(m.revalidate).not.toHaveBeenCalled();
  });

  it('rejects approved or paid payroll without invalidating successful caches', async () => {
    m.reconcile.mockResolvedValueOnce({ kind: 'LOCKED_PAYROLL' });
    const result = await reconcileMinutes(73, 47);
    expect(result).toMatchObject({ success: false, code: 'CONFLICT' });
    expect(m.reconcile).toHaveBeenCalledWith(73, 47);
    expect(m.revalidate).not.toHaveBeenCalled();
  });

  it.each(['OVERLAPPING_PAYROLLS', 'PAYROLL_LINK_MISMATCH'])(
    'rejects ambiguous financial reconciliation %s without refreshing caches', async kind => {
      m.reconcile.mockResolvedValueOnce({ kind });
      const result = await reconcileMinutes(73, 47);
      expect(result).toMatchObject({ success: false, code: 'CONFLICT' });
      expect(m.revalidate).not.toHaveBeenCalled();
    },
  );

  it('revalidates payroll and dashboard only after successful reconciliation', async () => {
    m.reconcile.mockResolvedValueOnce({ kind: 'UPDATED', log: { id: 73 } });
    const result = await reconcileMinutes(73, 47);
    expect(result).toMatchObject({ success: true });
    expect(m.revalidate).toHaveBeenCalledWith('/payroll');
    expect(m.revalidate).toHaveBeenCalledWith('/dashboard');
  });

  it('does not reveal transaction error messages through Server Action responses', async () => {
    m.reconcile.mockRejectedValueOnce(
      new Error('postgresql://admin:PRIVATE_PASSWORD@internal.invalid/db'),
    );
    const result = await reconcileMinutes(73, 47);
    expect(result).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_PASSWORD|postgresql:\/\//);
    expect(m.revalidate).not.toHaveBeenCalled();
  });
});
