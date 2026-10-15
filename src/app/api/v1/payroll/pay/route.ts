import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { PayrollPaySchema } from '@/lib/api-schemas';
import { apiError, parseJsonBody } from '@/lib/api-responses';
import { guardApiAuth } from '@/lib/api-auth';

export async function PATCH(request: Request) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return denied;

    const { payrollRecordId, transactionReference } = await parseJsonBody(request, PayrollPaySchema);

    // Check if payroll record exists and is in APPROVED state
    const payroll = await prisma.payrollRecord.findUnique({
      where: { id: payrollRecordId }
    });

    if (!payroll) {
      return NextResponse.json({ success: false, error: 'Payroll record not found' }, { status: 404 });
    }

    if (payroll.status !== 'APPROVED') {
      return NextResponse.json(
        { error: `Cannot mark as PAID. Payroll record is in ${payroll.status} state, must be APPROVED.` },
        { status: 403 }
      );
    }

    // Update state to PAID
    const updatedPayroll = await prisma.payrollRecord.update({
      where: { id: payrollRecordId },
      data: {
        status: 'PAID',
        transactionReference,
        paidAt: new Date(),
        paymentDate: new Date()
      }
    });

    return NextResponse.json({ success: true, data: updatedPayroll });
  } catch (error) {
    return apiError({ error, fallback: 'Internal Server Error' });
  }
}
