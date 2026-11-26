// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ record: vi.fn(), profile: vi.fn(), publish: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { payrollRecord: { findUnique: m.record }, userProfile: { findUnique: m.profile } } }));
vi.mock('./publish-notification-event', () => ({ publishNotificationEvent: m.publish }));
import { notifyPayrollMilestone, type PayrollMilestone } from './notify-payroll';
const id = '123e4567-e89b-42d3-a456-426614174000';
const paidAt = new Date('2026-11-26T12:00:00Z');
beforeEach(() => { vi.resetAllMocks(); m.profile.mockResolvedValue({ id, role: 'interpreter' }); });

describe('private payroll milestones', () => {
  it.each([
    ['approved', 'APPROVED', null], ['approved', 'Approved', null],
    ['paid', 'PAID', paidAt], ['paid', 'Paid', paidAt], ['rejected', 'REJECTED', null],
  ] as const)('publishes %s only for persisted %s', async (milestone, status, timestamp) => {
    m.record.mockResolvedValueOnce({ interpreterId: 7, status, paidAt: timestamp });
    await notifyPayrollMilestone('pay-1', milestone);
    expect(m.record).toHaveBeenCalledExactlyOnceWith({ where: { id: 'pay-1' }, select: { interpreterId: true, status: true, paidAt: true } });
    expect(m.profile).toHaveBeenCalledExactlyOnceWith({ where: { interpreterId: 7 }, select: { id: true, role: true } });
    expect(m.publish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ userId: id, eventKey: 'finance.payroll:pay-1:' + milestone, category: 'finance', link: '/dashboard/earnings' }));
    if (milestone === 'paid') expect(m.publish.mock.calls[0][0].message).toContain('verifica la recepción');
  });
  it.each([
    ['paid', 'APPROVED', null], ['paid', 'PAID', null],
    ['approved', 'PAID', paidAt], ['rejected', 'REJECTED', paidAt],
  ] as const)('suppresses inconsistent %s status %s', async (milestone, status, timestamp) => {
    m.record.mockResolvedValueOnce({ interpreterId: 7, status, paidAt: timestamp });
    await notifyPayrollMilestone('pay-1', milestone);
    expect(m.profile).not.toHaveBeenCalled();
    expect(m.publish).not.toHaveBeenCalled();
  });
  it('rejects unlinked and non-interpreter recipients', async () => {
    m.record.mockResolvedValueOnce({ interpreterId: null, status: 'PAID', paidAt });
    await notifyPayrollMilestone('pay-1', 'paid');
    expect(m.profile).not.toHaveBeenCalled();
    m.record.mockResolvedValue({ interpreterId: 7, status: 'PAID', paidAt });
    m.profile.mockResolvedValueOnce({ id, role: 'candidate' });
    await notifyPayrollMilestone('pay-1', 'paid');
    expect(m.publish).not.toHaveBeenCalled();
  });
  it('keeps notification failure isolated and redacts exception details', async () => {
    m.record.mockResolvedValue({ interpreterId: 7, status: 'PAID', paidAt });
    m.publish.mockRejectedValueOnce(new Error('PRIVATE_PASSWORD'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(notifyPayrollMilestone('pay-1', 'paid' satisfies PayrollMilestone)).resolves.toBeUndefined();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally { warn.mockRestore(); }
  });
});
