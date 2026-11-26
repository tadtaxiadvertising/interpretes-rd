import type { NotificationEvent } from './notification-event-row';
import { isPaidPayrollStatus } from '@/lib/payroll-validation';

export type PayrollMilestone = 'approved' | 'paid' | 'rejected';
export const PAYMENT_NOTICE_WINDOW_MS = 86_400_000;

export function payrollMilestoneEvent(userId: string, payrollId: string, milestone: PayrollMilestone): NotificationEvent {
  const copy = {
    approved: { title: 'Nómina aprobada', message: 'Una de tus nóminas ha sido aprobada. Consulta tus ingresos y pagos.', type: 'info' },
    paid: { title: 'Pago registrado', message: 'Una nómina figura como pagada en la plataforma. Consulta tus ingresos y pagos y verifica la recepción por tu medio de pago.', type: 'success' },
    rejected: { title: 'Nómina requiere revisión', message: 'Una de tus nóminas figura como rechazada. Consulta tus ingresos y pagos y contacta con administración si necesitas aclaraciones.', type: 'warning' },
  } as const;
  return {
    userId, eventKey: 'finance.payroll:' + payrollId + ':' + milestone,
    category: 'finance', ...copy[milestone], link: '/dashboard/earnings',
  };
}

export function isRecentRecordedPayment(record: { id: string; interpreterId: number | null; status: string | null; paidAt: Date | null }, now: Date): boolean {
  return typeof record.id === 'string' && record.id.length > 0 && record.id.length <= 128 &&
    record.interpreterId !== null && Number.isSafeInteger(record.interpreterId) && record.interpreterId > 0 &&
    isPaidPayrollStatus(record.status) && record.paidAt instanceof Date &&
    record.paidAt.getTime() >= now.getTime() - PAYMENT_NOTICE_WINDOW_MS && record.paidAt.getTime() <= now.getTime();
}
