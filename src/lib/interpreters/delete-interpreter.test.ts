import { describe, expect, it, vi } from 'vitest';
import { deleteInterpreterDatabaseRecords } from './delete-interpreter';

describe('deleteInterpreterDatabaseRecords', () => {
  it('cancels active sessions, detaches all Roleplay history, and preserves it', async () => {
    const emptyReference = () => ({ findFirst: vi.fn().mockResolvedValue(null) });
    const tx = {
      $queryRaw: vi.fn((_sql: TemplateStringsArray, _id: number) => Promise.resolve([{ id: 42 }])),
      interpreter: {
        findUnique: vi.fn().mockResolvedValue({ id: 42, userProfile: { id: 'auth-user-1' } }),
        delete: vi.fn().mockResolvedValue({ id: 42 }),
      },
      roleplaySession: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      userProfile: { deleteMany: vi.fn() },
      interpreterAccountRate: { deleteMany: vi.fn() },
      payrateAuditLog: { ...emptyReference(), deleteMany: vi.fn() },
      qAScore: { ...emptyReference(), deleteMany: vi.fn() },
      productionLog: { ...emptyReference(), deleteMany: vi.fn() },
      callSession: { ...emptyReference(), deleteMany: vi.fn() },
      payrollRecord: { ...emptyReference(), deleteMany: vi.fn() },
      interpreterStatusLog: emptyReference(),
      interpreterMonthlyMetrics: emptyReference(),
      interpreterAccountAssignment: emptyReference(),
      recruitmentApplication: emptyReference(),
    };

    const result = await deleteInterpreterDatabaseRecords(tx, 42);

    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.payrollRecord.findFirst).toHaveBeenCalledWith({
      where: { interpreterId: 42 },
      select: { id: true },
    });
    expect(tx.roleplaySession.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        interpreterId: 42,
        status: { in: ['DRAFT', 'INVITED', 'STARTED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW'] },
      },
      data: {
        interpreterId: null,
        status: 'CANCELLED',
        completedAt: expect.any(Date),
      },
    });
    expect(tx.roleplaySession.updateMany).toHaveBeenNthCalledWith(2, {
      where: { interpreterId: 42 },
      data: { interpreterId: null },
    });
    expect(tx.roleplaySession.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.interpreter.delete).toHaveBeenCalledWith({ where: { id: 42 } });
    expect(result).toEqual({ authUserId: 'auth-user-1' });
  });

  it('does not mutate records when the interpreter does not exist', async () => {
    const tx = {
      $queryRaw: vi.fn((_sql: TemplateStringsArray, _id: number) => Promise.resolve([])),
      interpreter: { findUnique: vi.fn().mockResolvedValue(null), delete: vi.fn() },
      roleplaySession: { updateMany: vi.fn() },
    };

    await expect(deleteInterpreterDatabaseRecords(tx, 404)).rejects.toThrow('Intérprete no encontrado');
    expect(tx.roleplaySession.updateMany).not.toHaveBeenCalled();
    expect(tx.interpreter.findUnique).not.toHaveBeenCalled();
    expect(tx.interpreter.delete).not.toHaveBeenCalled();
  });
});
