// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
const m = vi.hoisted(() => ({ transaction: vi.fn(), find: vi.fn(), update: vi.fn(), audit: vi.fn(), validate: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { $transaction: m.transaction } }));
vi.mock('@/lib/auth/actions', () => ({ validateAction: m.validate }));
vi.mock('@/lib/cache/revalidate-interpreter', () => ({ revalidateInterpreterProfileRecords: m.refresh }));
import { updatePayrate } from './payrates';

beforeEach(() => {
  vi.resetAllMocks();
  m.validate.mockResolvedValue({ user: { userId: 'admin-user' } });
  m.find.mockResolvedValue({ tariffPerMinute: new Prisma.Decimal('2.00') });
  m.transaction.mockImplementation(callback => callback({ interpreter: { findUnique: m.find, update: m.update }, payrateAuditLog: { create: m.audit } }));
});
afterEach(() => vi.restoreAllMocks());

describe('general rate integrity', () => {
  it('skips both writes when the effective stored value is unchanged', async () => {
    expect(await updatePayrate(7, 2.004)).toEqual({ success: true, data: { oldRate: 2, newRate: 2 } });
    expect(m.update).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
    expect(m.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });
  it('writes and returns the same effective decimal in the rate and audit', async () => {
    expect(await updatePayrate(7, 2.125)).toEqual({ success: true, data: { oldRate: 2, newRate: 2.13 } });
    expect(m.update.mock.calls[0][0].data.tariffPerMinute.toString()).toBe('2.13');
    expect(m.audit.mock.calls[0][0].data.newRate.toString()).toBe('2.13');
    expect(m.audit).toHaveBeenCalledTimes(1);
  });
  it('reports a committed change despite cache failure without logging credentials', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    m.refresh.mockImplementationOnce(() => { throw new Error('PRIVATE_PASSWORD'); });
    expect((await updatePayrate(7, 3)).success).toBe(true);
    expect(m.audit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_PASSWORD');
  });
  it('returns a conflict without retrying an aborted transaction', async () => {
    m.transaction.mockRejectedValueOnce({ code: 'P2034' });
    expect(await updatePayrate(7, 3)).toEqual(expect.objectContaining({ success: false, code: 'CONFLICT' }));
    expect(m.transaction).toHaveBeenCalledTimes(1);
    expect(m.refresh).not.toHaveBeenCalled();
  });
  it('rejects unauthorized and invalid inputs before accessing financial records', async () => {
    m.validate.mockResolvedValueOnce({ error: 'Forbidden', code: 'FORBIDDEN' });
    expect((await updatePayrate(7, 3)).success).toBe(false);
    expect((await updatePayrate(7, 0.001)).success).toBe(false);
    expect(m.transaction).not.toHaveBeenCalled();
  });
});
