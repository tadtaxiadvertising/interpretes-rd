import 'server-only';
import prisma from '@/lib/prisma';
import { isApprovedPayrollStatus, isPaidPayrollStatus } from '@/lib/payroll-validation';
import { publishNotificationEvent } from './publish-notification-event';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

import { payrollMilestoneEvent, type PayrollMilestone } from './payroll-notification-events';
export type { PayrollMilestone } from './payroll-notification-events';

/** Only call after a successful conditional write. Recheck persisted status and owner. */
export async function notifyPayrollMilestone(payrollId: string, milestone: PayrollMilestone): Promise<void> {
  if (typeof payrollId !== 'string' || !payrollId || payrollId.length > 128) return;
  try {
    const record = await prisma.payrollRecord.findUnique({
      where: { id: payrollId },
      select: { interpreterId: true, status: true, paidAt: true },
    });
    if (!record || record.interpreterId === null || !Number.isSafeInteger(record.interpreterId) || record.interpreterId <= 0) return;
    if (milestone === 'paid' ? !isPaidPayrollStatus(record.status) || !record.paidAt
      : milestone === 'approved' ? !isApprovedPayrollStatus(record.status) || record.paidAt !== null
      : record.status !== 'REJECTED' || record.paidAt !== null) return;
    const profile = await prisma.userProfile.findUnique({
      where: { interpreterId: record.interpreterId },
      select: { id: true, role: true },
    });
    if (profile?.role?.toLowerCase() !== 'interpreter' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(profile.id)) return;
    await publishNotificationEvent(payrollMilestoneEvent(profile.id, payrollId, milestone));
  } catch (error) {
    console.warn('[PAYROLL] Saved but notification failed:', safeServerErrorCategory(error));
  }
}
