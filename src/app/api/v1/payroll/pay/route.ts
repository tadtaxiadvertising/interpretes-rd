import prisma from '@/lib/prisma';
import { PayrollPaySchema } from '@/lib/api-schemas';
import { apiError, parseJsonBody } from '@/lib/api-responses';
import { guardApiAuth } from '@/lib/api-auth';
import { privateAdminJson, privateAdminResponse } from '@/lib/security/private-admin-response';

export async function PATCH(request: Request) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return privateAdminResponse(denied);

    const { payrollRecordId, transactionReference } = await parseJsonBody(request, PayrollPaySchema);

    // Check if payroll record exists and is in APPROVED state
    const payroll = await prisma.payrollRecord.findUnique({
      where: { id: payrollRecordId }
    });

    if (!payroll) {
      return privateAdminJson({ success: false, error: 'Payroll record not found' }, { status: 404 });
    }

    if (payroll.status !== 'APPROVED') {
      return privateAdminJson(
        { error: `Cannot mark as PAID. Payroll record is in ${payroll.status} state, must be APPROVED.` },
        { status: 403 }
      );
    }

    // Atomic claim to avoid races/double payment.
    const claim = await prisma.payrollRecord.updateMany({
      where: { id: payrollRecordId, status: 'APPROVED' },
      data: {
        status: 'PAID',
        transactionReference,
        paidAt: new Date(),
        paymentDate: new Date()
      }
    });

    if (claim.count === 0) {
      return privateAdminJson(
        { error: 'Concurrent modification detected; payroll record is no longer APPROVED.' },
        { status: 409 }
      );
    }

    const updatedPayroll = await prisma.payrollRecord.findUnique({
      where: { id: payrollRecordId },
    });

    return privateAdminJson({ success: true, data: updatedPayroll });
  } catch (error) {
    return privateAdminResponse(apiError({ error, fallback: 'Internal Server Error', exposeMessage: false }));
  }
}
