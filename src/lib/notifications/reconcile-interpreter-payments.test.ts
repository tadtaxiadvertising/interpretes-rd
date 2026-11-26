// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentActor } from '@/lib/auth/current-actor';
const m = vi.hoisted(() => ({ profile: vi.fn(), records: vi.fn(), insert: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { userProfile: { findUnique: m.profile }, payrollRecord: { findMany: m.records }, notification: { createMany: m.insert } } }));
import { reconcileInterpreterPayments } from './reconcile-interpreter-payments';
import { payrollMilestoneEvent } from './payroll-notification-events';
import { notificationEventRow } from './notification-event-row';
const now = Date.parse('2026-11-26T14:00:00Z');
const actor = (id: number): CurrentActor => ({ provider: 'authjs', userId: 'legacy-' + id, role: 'interpreter', interpreterId: 7, candidateId: null, profileId: '123e4567-e89b-42d3-a456-' + String(id).padStart(12, '0'), email: 'worker@example.test' });
const record = { id: 'pay-1', interpreterId: 7, status: 'PAID', paidAt: new Date(now) };
beforeEach(() => {
  vi.resetAllMocks();
  m.profile.mockImplementation(async ({ where }) => ({ id: where.id, role: 'interpreter', interpreterId: 7, email: 'worker@example.test' }));
  m.records.mockResolvedValue([]);
  m.insert.mockResolvedValue({ count: 1 });
});
describe('private recorded payment recovery', () => {
  it('uses the original deterministic event and only the linked interpreter', async () => {
    const a = actor(1);
    m.records.mockResolvedValueOnce([record, { ...record, id: 'old', paidAt: new Date(now - 86400001) }, { ...record, id: 'future', paidAt: new Date(now + 1) }, { ...record, id: 'unpaid', status: 'APPROVED' }, { ...record, id: 'missing', paidAt: null }, { ...record, id: 'other', interpreterId: 8 }]);
    await reconcileInterpreterPayments(a, now);
    expect(m.records).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ where: { interpreterId: 7, status: { in: ['Paid', 'PAID'] }, paidAt: { gte: new Date(now - 86400000), lte: new Date(now) } }, take: 50, orderBy: { id: 'asc' } }));
    expect(m.insert).toHaveBeenCalledExactlyOnceWith({ data: [notificationEventRow(payrollMilestoneEvent(a.profileId!, 'pay-1', 'paid'))], skipDuplicates: true });
  });
  it('rejects other roles and mismatched profile ownership', async () => {
    await reconcileInterpreterPayments({ ...actor(2), role: 'candidate' }, now);
    await reconcileInterpreterPayments({ ...actor(2), profileId: null }, now);
    expect(m.profile).not.toHaveBeenCalled();
    m.profile.mockResolvedValueOnce({ role: 'interpreter', interpreterId: 8, email: actor(3).email });
    await reconcileInterpreterPayments(actor(3), now);
    expect(m.records).not.toHaveBeenCalled();
    expect(m.insert).not.toHaveBeenCalled();
  });
  it('limits scans and advances then wraps its cursor', async () => {
    m.records.mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => ({ ...record, id: String(i + 1).padStart(2, '0') })));
    await reconcileInterpreterPayments(actor(4), now);
    await reconcileInterpreterPayments(actor(4), now + 1000);
    expect(m.records).toHaveBeenCalledTimes(1);
    await reconcileInterpreterPayments(actor(4), now + 300000);
    expect(m.records.mock.calls[1][0].where.id).toEqual({ gt: '50' });
    await reconcileInterpreterPayments(actor(4), now + 600000);
    expect(m.records.mock.calls[2][0].where.id).toBeUndefined();
  });
  it('retains the cursor after an insert failure without exposing exception contents', async () => {
    m.records.mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => ({ ...record, id: String(i + 1) })));
    m.insert.mockRejectedValueOnce(new Error('PRIVATE_PASSWORD'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await reconcileInterpreterPayments(actor(5), now);
      await reconcileInterpreterPayments(actor(5), now + 300000);
      expect(m.records.mock.calls[1][0].where.id).toBeUndefined();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally { warn.mockRestore(); }
  });
});
