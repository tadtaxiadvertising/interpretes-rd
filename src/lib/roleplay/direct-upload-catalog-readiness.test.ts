import type { PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ read: vi.fn(), classify: vi.fn(), accounting: vi.fn() }));
vi.mock('./direct-upload-reservation-catalog', () => ({
  readRoleplayReservationCatalog: m.read, classifyRoleplayReservationCatalog: m.classify,
}));
vi.mock('./direct-upload-budget-accounting', () => ({ readRoleplayBudgetAccounting: m.accounting }));
import { inspectDirectUploadCatalog } from './direct-upload-catalog-readiness';

function fixture() {
  const tx = { $executeRaw: vi.fn().mockResolvedValue(0), $queryRaw: vi.fn().mockResolvedValue([{ marker: true }]) };
  const transaction = vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
  return { tx, transaction, db: { $transaction: transaction } as unknown as Pick<PrismaClient, '$transaction'> };
}
const budget = { state: 'accounting-consistent', maxSlots: 25, allocatedSlots: 10, remainingSlots: 15,
  orphanCharges: 0, untrackedCharges: 0 };
beforeEach(() => {
  vi.resetAllMocks();
  m.read.mockResolvedValue({});
  m.classify.mockReturnValue('catalog-ready');
  m.accounting.mockResolvedValue({ budget });
});
describe('read-only direct upload runtime diagnostic', () => {
  it('opens a bounded read-only repeatable-read transaction and projects only aggregate capacity', async () => {
    const f = fixture();
    m.read.mockImplementation(async reader => {
      expect(await reader.query('SELECT true AS marker')).toEqual({ rows: [{ marker: true }], rowCount: 1 });
      return {};
    });
    expect(await inspectDirectUploadCatalog(f.db)).toEqual({
      reservation: 'catalog-ready', budget: 'accounting-consistent',
      capacity: { maxSlots: 25, allocatedSlots: 10, remainingSlots: 15 },
    });
    expect(f.transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead', maxWait: 2000, timeout: 5000,
    });
    expect(f.tx.$executeRaw.mock.calls[0][0][0]).toBe('SET TRANSACTION READ ONLY');
    expect(f.tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(m.read.mock.invocationCallOrder[0]);
    expect(m.accounting).toHaveBeenCalledOnce();
  });

  it.each([
    ['incomplete', 'accounting-consistent', 0, 0],
    ['catalog-ready', 'review-required', 0, 0],
    ['catalog-ready', 'accounting-consistent', 1, 0],
    ['catalog-ready', 'accounting-consistent', 0, 1],
  ] as const)('suppresses capacity for catalog=%s budget=%s orphan=%s untracked=%s',
    async (reservation, state, orphanCharges, untrackedCharges) => {
      m.classify.mockReturnValue(reservation);
      m.accounting.mockResolvedValue({ budget: { ...budget, state, orphanCharges, untrackedCharges } });
      expect(await inspectDirectUploadCatalog(fixture().db)).toEqual({ reservation, budget: state, capacity: null });
    });

  it('returns a fixed unavailable result on transaction or query errors', async () => {
    const f = fixture();
    m.accounting.mockRejectedValueOnce(new Error('PRIVATE_DATABASE_CONNECTION'));
    const unavailable = { reservation: 'unavailable', budget: 'unavailable', capacity: null };
    expect(await inspectDirectUploadCatalog(f.db)).toEqual(unavailable);
    f.tx.$executeRaw.mockRejectedValueOnce(new Error('PRIVATE_DATABASE_CONNECTION'));
    m.read.mockClear();
    expect(await inspectDirectUploadCatalog(f.db)).toEqual(unavailable);
    expect(m.read).not.toHaveBeenCalled();
  });
});
