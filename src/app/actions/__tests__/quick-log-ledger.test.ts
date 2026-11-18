// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/actions', () => ({ validateAction: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: { interpreter: { findUnique: vi.fn() }, $transaction: vi.fn() },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/cache/revalidate-interpreter', () => ({
  revalidateInterpreterProfileRecords: vi.fn(),
}));

import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { revalidatePath } from 'next/cache';
import { revalidateInterpreterProfileRecords } from '@/lib/cache/revalidate-interpreter';
import { quickLog } from '../quick-log';

const tx = {
  payrollRecord: { findFirst: vi.fn() },
  productionLog: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  callSession: { create: vi.fn() },
  callProductionEntry: { create: vi.fn() },
};

function form(minutes = '3', seconds = '20') {
  const data = new FormData();
  data.set('durationMinutes', minutes);
  data.set('seconds', seconds);
  return data;
}

describe('Quick Log Server Action accounting ledger and safe failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateAction).mockResolvedValue({
      user: { userId: 'synthetic-interpreter', role: 'interpreter' },
      profile: { interpreterId: 7, role: 'interpreter' },
    } as never);
    vi.mocked(prisma.interpreter.findUnique).mockResolvedValue({
      id: 7, tariffPerMinute: 0.2,
    } as never);
    tx.payrollRecord.findFirst.mockResolvedValue(null);
    tx.productionLog.findFirst.mockResolvedValue(null);
    tx.productionLog.create.mockResolvedValue({ id: 31 });
    tx.productionLog.update.mockResolvedValue({ id: 40 });
    tx.callSession.create.mockResolvedValue({ id: 18 });
    tx.callProductionEntry.create.mockResolvedValue({ callSessionId: 18 });
    vi.mocked(prisma.$transaction).mockImplementation(
      (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
    );
  });

  it('links newly created production to a single per-session ledger entry', async () => {
    const response = await quickLog(form('3', '20'));
    expect(response).toEqual({ success: true, data: { id: 18 } });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(tx.productionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        interpreterId: 7, interpretedMinutes: 3, callsAttended: 1,
      }),
      select: { id: true },
    });
    expect(tx.callProductionEntry.create).toHaveBeenCalledOnce();
    expect(tx.callProductionEntry.create).toHaveBeenCalledWith({
      data: {
        callSessionId: 18,
        interpreterId: 7,
        productionDate: expect.any(Date),
        interpretedMinutes: 3,
        callsAttended: 1,
        productionLogId: 31,
      },
    });
  });

  it('links an existing unsettled production log, without creating another day', async () => {
    tx.productionLog.findFirst.mockResolvedValueOnce({
      id: 40, interpretedMinutes: 5, callsAttended: 2, isSettled: false,
    });
    const response = await quickLog(form('2', '10'));
    expect(response.success).toBe(true);
    expect(tx.productionLog.create).not.toHaveBeenCalled();
    expect(tx.productionLog.update).toHaveBeenCalledWith({
      where: { id: 40, isSettled: false },
      data: { interpretedMinutes: 7, callsAttended: 3 },
    });
    expect(tx.callProductionEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ productionLogId: 40, interpretedMinutes: 2 }),
    });
  });

  it('preserves existing subminute call counting while recording zero whole minutes', async () => {
    const response = await quickLog(form('0', '45'));
    expect(response.success).toBe(true);
    expect(tx.callProductionEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        interpretedMinutes: 0, callsAttended: 1, productionLogId: 31,
      }),
    });
    expect(tx.productionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ interpretedMinutes: 0, callsAttended: 1 }),
      select: { id: true },
    });
  });

  it('does not insert sessions or ledger for paid or settled production', async () => {
    tx.payrollRecord.findFirst.mockResolvedValueOnce({ id: 'paid' });
    const paid = await quickLog(form());
    expect(paid).toMatchObject({ success: false, code: 'CONFLICT' });
    expect(tx.callSession.create).not.toHaveBeenCalled();

    tx.productionLog.findFirst.mockResolvedValueOnce({ id: 40, isSettled: true });
    const settled = await quickLog(form());
    expect(settled).toMatchObject({ success: false, code: 'CONFLICT' });
    expect(tx.callSession.create).not.toHaveBeenCalled();
    expect(tx.callProductionEntry.create).not.toHaveBeenCalled();
  });

  it('reports a ledger insertion error as unsaved and does not refresh caches', async () => {
    tx.callProductionEntry.create.mockRejectedValueOnce(
      new Error('postgresql://private:ULTRA_PRIVATE_PASSWORD@db.invalid/data'),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await quickLog(form());
      expect(result).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
      expect(tx.callSession.create).toHaveBeenCalledOnce();
      expect(tx.callProductionEntry.create).toHaveBeenCalledOnce();
      expect(revalidatePath).not.toHaveBeenCalled();
      expect(JSON.stringify(log.mock.calls)).not.toContain('ULTRA_PRIVATE_PASSWORD');
      expect(log).toHaveBeenCalledWith('quickLog failed:', 'Error');
    } finally { log.mockRestore(); }
  });

  it('never claims a committed session failed when cache revalidation throws', async () => {
    vi.mocked(revalidatePath).mockImplementationOnce(() => {
      throw new Error('PRIVATE_CACHED_URL');
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await quickLog(form())).toEqual({ success: true, data: { id: 18 } });
      expect(warning).toHaveBeenCalledWith(
        'Quick Log saved; cache revalidation failed:', 'Error',
      );
      expect(JSON.stringify(warning.mock.calls)).not.toContain('PRIVATE_CACHED_URL');
    } finally { warning.mockRestore(); }
  });

  it('redacts upstream database exceptions and blocks invalid input before the transaction', async () => {
    vi.mocked(prisma.interpreter.findUnique).mockRejectedValueOnce(
      new Error('postgresql://private:VERY_SECRET@db.invalid/data'),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await quickLog(form())).success).toBe(false);
      expect(JSON.stringify(log.mock.calls)).not.toContain('VERY_SECRET');
      expect(log).toHaveBeenCalledWith('quickLog failed:', 'Error');
    } finally { log.mockRestore(); }
    vi.clearAllMocks();
    const invalid = await quickLog(form('0', '0'));
    expect(invalid).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects unauthorized interpreters before reading production', async () => {
    vi.mocked(validateAction).mockResolvedValueOnce({
      error: 'Not authenticated', code: 'UNAUTHORIZED',
    } as never);
    expect((await quickLog(form())).success).toBe(false);
    expect(prisma.interpreter.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
