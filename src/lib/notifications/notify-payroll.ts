import 'server-only';
import prisma from '@/lib/prisma';
import { isApprovedPayrollStatus, isPaidPayrollStatus } from '@/lib/payroll-validation';
import { publishNotificationEvent } from './publish-notification-event';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

export type PayrollMilestone = 'approved' | 'paid' | 'rejected';

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
    const copy = {
      approved: { title: 'Nómina aprobada', message: 'Una de tus nóminas ha sido aprobada. Consulta tus ingresos y pagos.', type: 'info' },
      paid: { title: 'Pago registrado', message: 'Una nómina figura como pagada en la plataforma. Consulta tus ingresos y pagos y verifica la recepción por tu medio de pago.', type: 'success' },
      rejected: { title: 'Nómina requiere revisión', message: 'Una de tus nóminas figura como rechazada. Consulta tus ingresos y pagos y contacta con administración si necesitas aclaraciones.', type: 'warning' },
    } as const;
    await publishNotificationEvent({
      userId: profile.id,
      eventKey: 'finance.payroll:' + payrollId + ':' + milestone,
      category: 'finance',
      ...copy[milestone],
      link: '/dashboard/earnings',
    });
  } catch (error) {
    console.warn('[PAYROLL] Saved but notification failed:', safeServerErrorCategory(error));
  }
}
