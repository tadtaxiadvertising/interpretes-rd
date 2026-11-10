'use server';

import prisma from '@/lib/prisma';
import { createPayrollRecord } from '@/lib/payroll';
import { refreshPayrollRecord } from '@/services/PayrollService';
import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/types';
import { validateAction } from '@/lib/auth/actions';
import { z } from 'zod';

const db = prisma;

const ReconcileSchema = z.object({
  logId: z.coerce.number().int().positive(),
  verifiedMinutes: z.coerce.number().int().min(1).max(100_000),
});

const PeriodSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

export async function generatePayrollPeriod(
  startDate?: Date,
  endDate?: Date
): Promise<ActionResult<{ message: string }>> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    const validated = PeriodSchema.parse({ startDate, endDate });
    const now = new Date();
    const periodStart = validated.startDate || new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = validated.endDate || new Date(now.getFullYear(), now.getMonth(), 15);
    const periodLength = periodEnd.getTime() - periodStart.getTime();
    if (periodLength < 0 || periodLength > 366 * 24 * 60 * 60 * 1000) {
      return { success: false, error: 'El período de nómina debe ser válido y no superar 366 días.', code: 'VALIDATION_ERROR' };
    }

    // Obtener todos los intérpretes activos via Prisma
    const interpreters = await db.interpreter.findMany({
      where: { status: 'Activo' },
      select: { id: true }
    });
    
    if (!interpreters || interpreters.length === 0) {
      return { success: false, error: 'No active interpreters found to process payroll.' };
    }

    let successCount = 0;
    
    for (const interpreter of interpreters) {
      try {
        // Check if payroll already generated for this period via Prisma
        const existing = await db.payrollRecord.findFirst({
          where: {
            interpreterId: interpreter.id,
            periodStart: periodStart,
            periodEnd: periodEnd
          },
          select: { id: true }
        });
        
        if (!existing) {
          await createPayrollRecord(interpreter.id, periodStart, periodEnd);
          successCount++;
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`Error generating payroll for interpreter ${interpreter.id}:`, errorMsg);
      }
    }

    revalidatePath('/payroll');
    return { 
      success: true, 
      data: { message: `Successfully generated ${successCount} payroll records.` }
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to generate payroll:', message);
    return { success: false, error: message };
  }
}

export async function reconcileMinutes(
  logId: number,
  verifiedMinutes: number
): Promise<ActionResult<{ message: string }>> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    const validated = ReconcileSchema.parse({ logId, verifiedMinutes });

    const log = await db.productionLog.findUnique({
      where: { id: validated.logId },
      select: { id: true, interpreterId: true, date: true }
    });

    if (!log) {
      return { success: false, error: 'Production log not found', code: 'NOT_FOUND' };
    }

    const linkedPaidPayroll = await db.payrollRecord.findFirst({
      where: {
        interpreterId: log.interpreterId,
        status: 'PAID',
        periodStart: { lte: log.date },
        periodEnd: { gte: log.date }
      },
      select: { id: true }
    });

    if (linkedPaidPayroll) {
      return { success: false, error: 'Cannot modify: Log is linked to a PAID payroll record', code: 'UNAUTHORIZED' };
    }

    await db.productionLog.update({
      where: { id: validated.logId },
      data: { verifiedMinutes: validated.verifiedMinutes },
      select: { id: true }
    });

    // Automatically refresh the payroll record if it exists and is pending
    if (log.interpreterId) {
      await refreshPayrollRecord(log.interpreterId, log.date);
    }

    revalidatePath('/payroll');
    revalidatePath('/dashboard');
    return { success: true, data: { message: 'Minutes successfully reconciled and payroll updated' } };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { success: false, error: 'Invalid input data', code: 'VALIDATION_ERROR' };
    }
    return { success: false, error: 'Internal Server Error', code: 'INTERNAL_ERROR' };
  }
}
