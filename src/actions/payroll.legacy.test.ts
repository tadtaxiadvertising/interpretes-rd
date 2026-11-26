// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/auth/actions', () => ({ validateAction: m.auth }));
vi.mock('@/lib/prisma', () => ({ default: { $transaction: m.transaction } }));
import { calculateInterpreterPayrollAction } from './payroll';
beforeEach(() => vi.resetAllMocks());
describe('retired payroll calculator', () => {
  it('denies non-administrators before any financial write', async () => {
    m.auth.mockResolvedValueOnce({ error: 'Forbidden', code: 'FORBIDDEN' });
    expect(await calculateInterpreterPayrollAction(null, new FormData())).toEqual({ success: false, error: 'Forbidden', code: 'FORBIDDEN' });
    expect(m.auth).toHaveBeenCalledExactlyOnceWith('admin');
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it('directs administrators to the supported payroll workflow without touching the ledger', async () => {
    m.auth.mockResolvedValueOnce({ user: { role: 'admin' } });
    expect(await calculateInterpreterPayrollAction(null, new FormData())).toMatchObject({ success: false, code: 'LEGACY_PAYROLL_DISABLED' });
    expect(m.transaction).not.toHaveBeenCalled();
  });
});
