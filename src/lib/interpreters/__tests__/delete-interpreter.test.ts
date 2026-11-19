// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  deleteInterpreterDatabaseRecords,
  InterpreterNotFoundError,
  InterpreterHasHistoricalRecordsError,
  InterpreterLegacyIdentityReviewRequiredError,
  InterpreterLegacyIdentityCheckUnavailableError,
} from '../delete-interpreter';

const protectedModels = [
  'payrollRecord',
  'callSession',
  'productionLog',
  'qAScore',
  'payrateAuditLog',
  'interpreterStatusLog',
  'interpreterMonthlyMetrics',
  'interpreterAccountAssignment',
  'recruitmentApplication',
] as const;

function makeTransaction() {
  const emptyHistory = () => ({ findFirst: vi.fn().mockResolvedValue(null) });
  const withDeletion = () => ({
    ...emptyHistory(),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  });
  return {
    $queryRaw: vi.fn((_query: TemplateStringsArray, _id: number) => Promise.resolve([{ id: 12 }])),
    interpreter: {
      findUnique: vi.fn().mockResolvedValue({
        id: 12,
        emailCorporativo: 'corporate@example.test',
        userProfile: { id: 'fictional-auth-id', email: 'profile@example.test' },
      }),
      delete: vi.fn().mockResolvedValue({ id: 12 }),
    },
    roleplaySession: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    rbacUser: { findFirst: vi.fn().mockResolvedValue(null) },
    userProfile: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    interpreterAccountRate: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    payrollRecord: withDeletion(),
    callSession: withDeletion(),
    productionLog: withDeletion(),
    qAScore: withDeletion(),
    payrateAuditLog: withDeletion(),
    interpreterStatusLog: emptyHistory(),
    interpreterMonthlyMetrics: emptyHistory(),
    interpreterAccountAssignment: emptyHistory(),
    recruitmentApplication: emptyHistory(),
  };
}

describe('interpreter hard-delete historical evidence guard', () => {
  it('takes a row lock before reading history and permits history-free deletion', async () => {
    const tx = makeTransaction();
    const result = await deleteInterpreterDatabaseRecords(tx, 12);
    expect(result).toEqual({ authUserId: 'fictional-auth-id' });
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    const [sql, id] = tx.$queryRaw.mock.calls[0];
    expect(Array.from(sql).join('')).toContain('FOR UPDATE');
    expect(id).toBe(12);
    for (const model of protectedModels) {
      expect(tx[model].findFirst).toHaveBeenCalledOnce();
    }
    expect(tx.rbacUser.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { email: { equals: 'corporate@example.test', mode: 'insensitive' } },
          { email: { equals: 'profile@example.test', mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    expect(tx.rbacUser.findFirst.mock.invocationCallOrder[0])
      .toBeLessThan(tx.roleplaySession.updateMany.mock.invocationCallOrder[0]);
    expect(tx.interpreter.delete).toHaveBeenCalledWith({ where: { id: 12 } });
  });

  it('does not attempt writes for a missing interpreter', async () => {
    const tx = makeTransaction();
    tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(deleteInterpreterDatabaseRecords(tx, 12))
      .rejects.toBeInstanceOf(InterpreterNotFoundError);
    expect(tx.interpreter.findUnique).not.toHaveBeenCalled();
    expect(tx.interpreter.delete).not.toHaveBeenCalled();
    expect(tx.roleplaySession.updateMany).not.toHaveBeenCalled();
  });

  it.each(protectedModels)('refuses to erase %s history and never starts destructive writes', async (model) => {
    const tx = makeTransaction();
    tx[model].findFirst.mockResolvedValueOnce({ id: 99 });
    await expect(deleteInterpreterDatabaseRecords(tx, 12))
      .rejects.toBeInstanceOf(InterpreterHasHistoricalRecordsError);
    expect(tx.interpreter.delete).not.toHaveBeenCalled();
    expect(tx.roleplaySession.updateMany).not.toHaveBeenCalled();
    expect(tx.userProfile.deleteMany).not.toHaveBeenCalled();
    expect(tx.payrollRecord.deleteMany).not.toHaveBeenCalled();
    expect(tx.callSession.deleteMany).not.toHaveBeenCalled();
    expect(tx.productionLog.deleteMany).not.toHaveBeenCalled();
  });

  it.each(['corporate@example.test', 'profile@example.test'])(
    'blocks a possible independent legacy login associated with %s before all destructive writes',
    async (matchedEmail) => {
      const tx = makeTransaction();
      tx.rbacUser.findFirst.mockResolvedValueOnce({ id: 'unrelated-or-legacy-identity' });
      await expect(deleteInterpreterDatabaseRecords(tx, 12))
        .rejects.toBeInstanceOf(InterpreterLegacyIdentityReviewRequiredError);
      expect(tx.rbacUser.findFirst).toHaveBeenCalledOnce();
      expect(tx.rbacUser.findFirst.mock.calls[0][0].where.OR).toContainEqual({
        email: { equals: matchedEmail, mode: 'insensitive' },
      });
      expect(tx.roleplaySession.updateMany).not.toHaveBeenCalled();
      expect(tx.userProfile.deleteMany).not.toHaveBeenCalled();
      expect(tx.interpreter.delete).not.toHaveBeenCalled();
    },
  );

  it('normalizes and deduplicates the two emails before inspecting Auth.js', async () => {
    const tx = makeTransaction();
    tx.interpreter.findUnique.mockResolvedValueOnce({
      id: 12,
      emailCorporativo: '  Employee@Example.Test  ',
      userProfile: { id: 'fictional-auth-id', email: 'employee@example.test' },
    });
    const result = await deleteInterpreterDatabaseRecords(tx, 12);
    expect(result).toEqual({ authUserId: 'fictional-auth-id' });
    expect(tx.rbacUser.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ email: { equals: 'employee@example.test', mode: 'insensitive' } }] },
      select: { id: true },
    });
  });

  it('fails closed on legacy directory query failure before any destructive writes', async () => {
    const tx = makeTransaction();
    tx.rbacUser.findFirst.mockRejectedValueOnce(
      new Error('postgresql://PRIVATE_DB_PASSWORD@synthetic.invalid'),
    );
    await expect(deleteInterpreterDatabaseRecords(tx, 12))
      .rejects.toBeInstanceOf(InterpreterLegacyIdentityCheckUnavailableError);
    expect(tx.roleplaySession.updateMany).not.toHaveBeenCalled();
    expect(tx.userProfile.deleteMany).not.toHaveBeenCalled();
    expect(tx.interpreter.delete).not.toHaveBeenCalled();
  });

  it('fails closed if the linked Auth profile has no verifiable email', async () => {
    const tx = makeTransaction();
    tx.interpreter.findUnique.mockResolvedValueOnce({
      id: 12, emailCorporativo: null, userProfile: { id: 'fictional-auth-id', email: '' },
    });
    await expect(deleteInterpreterDatabaseRecords(tx, 12))
      .rejects.toBeInstanceOf(InterpreterLegacyIdentityCheckUnavailableError);
    expect(tx.rbacUser.findFirst).not.toHaveBeenCalled();
    expect(tx.interpreter.delete).not.toHaveBeenCalled();
  });

  it('does not query legacy identity directory for passwordless interpreters with no email', async () => {
    const tx = makeTransaction();
    tx.interpreter.findUnique.mockResolvedValueOnce({
      id: 12, emailCorporativo: null, userProfile: null,
    });
    const result = await deleteInterpreterDatabaseRecords(tx, 12);
    expect(result).toEqual({ authUserId: null });
    expect(tx.rbacUser.findFirst).not.toHaveBeenCalled();
    expect(tx.interpreter.delete).toHaveBeenCalledOnce();
  });

  it('fails closed on a history lookup failure', async () => {
    const tx = makeTransaction();
    tx.payrollRecord.findFirst.mockRejectedValueOnce(new Error('synthetic DB failure'));
    await expect(deleteInterpreterDatabaseRecords(tx, 12)).rejects.toThrow('synthetic DB failure');
    expect(tx.interpreter.delete).not.toHaveBeenCalled();
    expect(tx.roleplaySession.updateMany).not.toHaveBeenCalled();
  });
});
