'use server';

import prisma from '@/lib/prisma';
import { createPayrollRecord } from '@/lib/payroll';
import { reconcileProductionMinutes } from '@/lib/payroll/reconcile-production-minutes';
import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/types';
import { validateAction } from '@/lib/auth/actions';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';
import { z } from 'zod';

const db = prisma;

const ReconcileSchema = z.object({
  logId: z.coerce.number().int().positive(),
  verifiedMinutes: z.coerce.number().int().min(0).max(100_000),
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
    let failureCount = 0;
    
    for (const interpreter of interpreters) {
      try {
        // The unique database constraint is the final idempotency guard.
        // The lookup avoids unnecessary calculations on normal repeated runs.
        const existing = await db.payrollRecord.findFirst({
          where: {
            interpreterId: interpreter.id,
            periodStart,
            periodEnd,
          },
          select: { id: true }
        });
        
        if (!existing) {
          await createPayrollRecord(interpreter.id, periodStart, periodEnd);
          successCount++;
        }
      } catch (err: unknown) {
        // A concurrent request may have inserted the unique period record
        // after our lookup. Treat that race as an idempotent no-op.
        if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
          continue;
        }
        failureCount++;
        // Prisma errors can contain connection strings and payroll details.
        // Log only a safe fixed category, never the exception or identifier.
        console.error('[PAYROLL] Generation failed:', safeServerErrorCategory(err));
      }
    }

    revalidatePath('/payroll');
    if (failureCount > 0) {
      return {
        success: false,
        error: `Nómina parcialmente procesada: ${successCount} registros creados y ${failureCount} fallidos. Revisa los registros del servidor antes de reintentar.`,
        code: 'INTERNAL_ERROR',
      };
    }
    return {
      success: true,
      data: { message: `Se generaron ${successCount} registros de nómina nuevos; los registros existentes se conservaron.` }
    };
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return { success: false, error: 'Invalid payroll period input', code: 'VALIDATION_ERROR' };
    }
    console.error('Failed to generate payroll:', safeServerErrorCategory(error));
    return { success: false, error: 'Failed to generate payroll', code: 'INTERNAL_ERROR' };
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

    const reconciliation = await reconcileProductionMinutes(validated.logId, validated.verifiedMinutes);

    if (reconciliation.kind !== 'UPDATED') {
      const errors = {
        NOT_FOUND: ['Production log not found', 'NOT_FOUND'],
        INVALID_LOG: ['Production log is not linked to an interpreter', 'VALIDATION_ERROR'],
        SETTLED: ['Cannot modify: Log is already settled', 'CONFLICT'],
        LOCKED_PAYROLL: ['Cannot modify: Log is linked to a payroll record that is no longer pending', 'CONFLICT'],
        CONFLICT: ['The production log changed during reconciliation; reload and retry', 'CONFLICT'],
      } as const;
      const [error, code] = errors[reconciliation.kind];
      return { success: false, error, code };
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
