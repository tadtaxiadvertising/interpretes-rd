import type { PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), classify: vi.fn(), access: vi.fn() }));
vi.mock('./creation-ledger-catalog', () => ({
  readCreationLedgerCatalog: mocks.read,
  classifyCreationLedgerCatalog: mocks.classify,
  hasCreationLedgerRuntimeAccess: mocks.access,
}));
import { isCreationLedgerReady } from './creation-ledger-readiness';

function database() {
  const tx = { $queryRaw: vi.fn() };
  const transaction = vi.fn(async (callback: (client: typeof tx) => Promise<boolean>) => callback(tx));
  const db = { $transaction: transaction } as unknown as Pick<PrismaClient, '$transaction'>;
  return { db, transaction };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue({});
  mocks.classify.mockReturnValue('hardened-catalog');
  mocks.access.mockResolvedValue(true);
});
describe('runtime creation ledger readiness', () => {
  it.each(['absent', 'historical', 'incomplete'])('rejects %s without checking permissions', async state => {
    mocks.classify.mockReturnValue(state);
    expect(await isCreationLedgerReady(database().db)).toBe(false);
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it('requires both hardened catalog and effective connection permissions', async () => {
    const { db, transaction } = database();
    expect(await isCreationLedgerReady(db)).toBe(true);
    mocks.access.mockResolvedValueOnce(false);
    expect(await isCreationLedgerReady(db)).toBe(false);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead', maxWait: 2000, timeout: 5000 });
  });
  it('rejects catalog, permissions and transaction failures without throwing', async () => {
    const { db, transaction } = database();
    mocks.read.mockRejectedValueOnce(new Error('private error'));
    expect(await isCreationLedgerReady(db)).toBe(false);
    mocks.access.mockRejectedValueOnce(new Error('private error'));
    expect(await isCreationLedgerReady(db)).toBe(false);
    transaction.mockRejectedValueOnce(new Error('private error'));
    expect(await isCreationLedgerReady(db)).toBe(false);
  });
});
