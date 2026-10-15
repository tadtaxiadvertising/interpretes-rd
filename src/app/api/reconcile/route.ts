import { NextResponse, NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { withSecurity } from '@/lib/api-security';
import { guardApiAuth } from '@/lib/api-auth';
import { z } from 'zod';

export const PATCH = withSecurity(async (request: NextRequest) => {
  const denied = await guardApiAuth(request, 'admin');
  if (denied) return denied;

  const body = await request.json();
  const { logId, verifiedMinutes } = body;

  // 1. Fetch the log
  const log = await prisma.productionLog.findUnique({
    where: { id: logId }
  });

  if (!log) {
    return NextResponse.json({ error: 'Production log not found' }, { status: 404 });
  }

  // 2. Check if linked to a PAID payroll record
  const linkedPaidPayroll = await prisma.payrollRecord.findFirst({
    where: {
      interpreterId: log.interpreterId,
      status: 'PAID',
      periodStart: { lte: log.date },
      periodEnd: { gte: log.date }
    }
  });

  if (linkedPaidPayroll) {
    return NextResponse.json(
      { error: 'Cannot modify verifiedMinutes: Log is linked to a PAID payroll record' },
      { status: 403 }
    );
  }

  // 3. Update the log
  const updatedLog = await prisma.productionLog.update({
    where: { id: logId },
    data: { verifiedMinutes: Number(verifiedMinutes) }
  });

  return NextResponse.json({ success: true, data: updatedLog });
}, {
  body: z.object({
    logId: z.number().int().positive(),
    verifiedMinutes: z.number().nonnegative()
  })
});
