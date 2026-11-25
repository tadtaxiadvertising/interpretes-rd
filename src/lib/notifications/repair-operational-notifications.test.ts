// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ transaction: vi.fn(), collect: vi.fn(), stored: vi.fn(), create: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { $transaction: m.transaction } }));
vi.mock('./operational-notification-diagnostics', () => ({
  collectOperationalNotificationRows: m.collect,
  findStoredOperationalNotices: m.stored,
}));
import { repairOperationalNotifications } from './repair-operational-notifications';
import { notificationEventRow } from './notification-event-row';
import { qaEvaluationEvent } from './evaluation-notification-events';
import { roleplayAssignmentEvent } from './communication-notification-events';

const now = new Date('2026-11-25T21:00:00Z');
const uid = '123e4567-e89b-42d3-a456-426614174000';
const row = (id: number) => notificationEventRow(qaEvaluationEvent(uid, { evaluationId: id, totalScore: 90, actionRequired: 'Ninguna' }));
const tx = { notification: { createMany: m.create } };
const other = notificationEventRow(roleplayAssignmentEvent(uid, 'session-1'));
beforeEach(() => {
  vi.resetAllMocks();
  m.transaction.mockImplementation(async callback => callback(tx));
  m.collect.mockResolvedValue({ expected: new Map([['qa', [row(1), row(2), row(3)]], ['roleplayAssignment', [other]]]), truncated: false });
  m.stored.mockResolvedValue(new Map());
  m.create.mockResolvedValue({ count: 1 });
});

describe('operational notification repair', () => {
  it('recalculates the sample inside the transaction and writes only absent notices in the chosen module', async () => {
    m.stored.mockResolvedValueOnce(new Map([[row(1).id, row(1)], [row(2).id, { ...row(2), category: 'system' }]]));
    expect(await repairOperationalNotifications('qa', now)).toEqual({
      module: 'qa', eligible: 3, truncated: false, created: 1, conflicts: 1, deferred: 0, skipped: 0, repairLimit: 50,
    });
    expect(m.collect).toHaveBeenCalledExactlyOnceWith(tx, now);
    expect(m.stored).toHaveBeenCalledExactlyOnceWith(tx, [row(1), row(2), row(3)]);
    expect(m.create).toHaveBeenCalledExactlyOnceWith({ data: [row(3)], skipDuplicates: true });
    expect(m.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });
  it('limits each batch and reports remaining and skipped deliveries', async () => {
    m.collect.mockResolvedValueOnce({ expected: new Map([['qa', Array.from({ length: 80 }, (_, i) => row(i + 1))]]), truncated: true });
    m.create.mockResolvedValueOnce({ count: 48 });
    expect(await repairOperationalNotifications('qa', now)).toMatchObject({ eligible: 80, truncated: true, created: 48, deferred: 30, skipped: 2 });
    expect(m.create.mock.calls[0][0].data).toHaveLength(50);
  });
  it('never rewrites an existing delivery even on repeated repair', async () => {
    m.stored.mockResolvedValueOnce(new Map([[row(1).id, row(1)], [row(2).id, row(2)]]))
      .mockResolvedValueOnce(new Map([1, 2, 3].map(id => [row(id).id, row(id)])));
    expect(await repairOperationalNotifications('qa', now)).toMatchObject({ created: 1 });
    expect(await repairOperationalNotifications('qa', now)).toMatchObject({ created: 0 });
    expect(m.create).toHaveBeenCalledTimes(1);
  });
  it('propagates failed transactions rather than reporting success', async () => {
    m.transaction.mockRejectedValueOnce(new Error('transaction failed'));
    await expect(repairOperationalNotifications('qa', now)).rejects.toThrow('transaction failed');
  });
});
