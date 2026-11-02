import { describe, expect, it, vi } from 'vitest';
import { deleteInterpreterDatabaseRecords } from './delete-interpreter';

describe('deleteInterpreterDatabaseRecords', () => {
  it('cancels active sessions, detaches all Roleplay history, and preserves it', async () => {
    const tx = {
      interpreter: {
        findUnique: vi.fn().mockResolvedValue({ id: 42, userProfile: { id: 'auth-user-1' } }),
        delete: vi.fn().mockResolvedValue({ id: 42 }),
      },
      roleplaySession: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      userProfile: { deleteMany: vi.fn() },
      interpreterAccountRate: { deleteMany: vi.fn() },
      payrateAuditLog: { deleteMany: vi.fn() },
      qAScore: { deleteMany: vi.fn() },
      productionLog: { deleteMany: vi.fn() },
      callSession: { deleteMany: vi.fn() },
      payrollRecord: { deleteMany: vi.fn() },
    };

    const result = await deleteInterpreterDatabaseRecords(tx, 42);

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
      interpreter: { findUnique: vi.fn().mockResolvedValue(null), delete: vi.fn() },
      roleplaySession: { updateMany: vi.fn() },
    };

    await expect(deleteInterpreterDatabaseRecords(tx, 404)).rejects.toThrow('Intérprete no encontrado');
    expect(tx.roleplaySession.updateMany).not.toHaveBeenCalled();
    expect(tx.interpreter.delete).not.toHaveBeenCalled();
  });
});
