import prisma from '@/lib/prisma';
import { refreshPayrollRecord } from '@/services/PayrollService';

/**
 * Shared financial reconciliation for HTTP and Server Actions.
 *
 * It is unsafe to treat a log as editable solely because its payroll status
 * field is not 'PAID'. A record may already be settled, approved, or paidAt
 * may be set independently. Every eligibility check, update and recalculation
 * must participate in the same serializable transaction.
 */
export async function reconcileProductionMinutes(logId: number, verifiedMinutes: number) {
  return prisma.$transaction(async (tx) => {
    const log = await tx.productionLog.findUnique({
      where: { id: logId },
      select: {
        id: true,
        interpreterId: true,
        date: true,
        isSettled: true,
        payrollRecordId: true,
      },
    });
    if (!log) return { kind: 'NOT_FOUND' as const };
    if (!log.interpreterId) return { kind: 'INVALID_LOG' as const };
    if (log.isSettled) return { kind: 'SETTLED' as const };

    // Pending is the only payroll state that refreshPayrollRecord actually
    // recalculates. Every other state is immutable through reconciliation,
    // including approved-but-not-paid and unknown legacy state strings.
    const lockedPayroll = await tx.payrollRecord.findFirst({
      where: {
        OR: [
          ...(log.payrollRecordId ? [{ id: log.payrollRecordId }] : []),
          {
            interpreterId: log.interpreterId,
            periodStart: { lte: log.date },
            periodEnd: { gte: log.date },
          },
        ],
        AND: [{
          OR: [
            { paidAt: { not: null } },
            { status: { notIn: ['PENDING', 'Pendiente'] } },
            { status: null },
          ],
        }],
      },
      select: { id: true },
    });
    if (lockedPayroll) return { kind: 'LOCKED_PAYROLL' as const };

    // One production day must not silently alter only one of two overlapping
    // pending payroll periods. The current schema has no exclusion constraint
    // against overlapping periods for the same interpreter.
    const matchingPending = await tx.payrollRecord.findMany({
      where: {
        interpreterId: log.interpreterId,
        periodStart: { lte: log.date },
        periodEnd: { gte: log.date },
        status: { in: ['PENDING', 'Pendiente'] },
        paidAt: null,
      },
      select: { id: true },
      take: 2,
    });
    if (matchingPending.length > 1) {
      return { kind: 'OVERLAPPING_PAYROLLS' as const };
    }

    // The ledger link is stronger than a date overlap. An orphaned or
    // mismatched link would otherwise allow updating verified minutes while
    // refreshPayrollRecord recalculates an unrelated (or no) payroll.
    if (log.payrollRecordId &&
        (matchingPending.length !== 1 || matchingPending[0].id !== log.payrollRecordId)) {
      return { kind: 'PAYROLL_LINK_MISMATCH' as const };
    }

    const updated = await tx.productionLog.updateMany({
      where: { id: log.id, isSettled: false },
      data: { verifiedMinutes },
    });
    if (updated.count !== 1) return { kind: 'CONFLICT' as const };

    // If calculation fails, PostgreSQL rolls back this log change as well.
    await refreshPayrollRecord(log.interpreterId, log.date, tx);

    // Preserve the legacy HTTP response shape without another transaction.
    const updatedLog = await tx.productionLog.findUnique({
      where: { id: log.id },
    });
    if (!updatedLog) throw new Error('Reconciled log disappeared during transaction');
    return { kind: 'UPDATED' as const, log: updatedLog };
  }, { isolationLevel: 'Serializable' });
}
