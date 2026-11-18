'use server';

import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import type { ActionResult } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { revalidateInterpreterProfileRecords } from '@/lib/cache/revalidate-interpreter';
import { z } from 'zod';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

const db = prisma;
const MAX_DURATION_MINUTES = 100_000;
const MAX_DB_AMOUNT = 99_999_999.99;

const QuickLogSchema = z.object({
  durationMinutes: z.coerce.number().int().min(0).max(MAX_DURATION_MINUTES),
  seconds: z.coerce.number().int().min(0).max(59),
});

/**
 * Creates a call session and updates the authenticated interpreter's production
 * log for today. A paid or settled period is immutable.
 */
export async function quickLog(formData: FormData): Promise<ActionResult<{ id: number }>> {
  const auth = await validateAction('interpreter');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  const interpreterId = auth.profile.interpreterId;
  if (!interpreterId) {
    return { success: false, error: 'Interpreter profile not found', code: 'NOT_FOUND' };
  }

  try {
    const validated = QuickLogSchema.parse({
      durationMinutes: formData.get('durationMinutes'),
      seconds: formData.get('seconds'),
    });
    const durationSeconds = validated.durationMinutes * 60 + validated.seconds;
    if (durationSeconds <= 0) {
      return { success: false, error: 'Duration must be positive', code: 'VALIDATION_ERROR' };
    }

    const interpreter = await db.interpreter.findUnique({
      where: { id: interpreterId },
      select: { id: true, tariffPerMinute: true },
    });
    if (!interpreter) {
      return { success: false, error: 'Interpreter not found', code: 'NOT_FOUND' };
    }

    const now = new Date();
    const startedAt = new Date(now.getTime() - durationSeconds * 1000);
    // Use the call's *start day* for all accounting. API Quick Log and
    // endCall already use startedAt, not the submission/end timestamp.
    // Otherwise a call logged at 00:01 that began at 23:59 can silently
    // increment the next day's ProductionLog or evade yesterday's payroll lock.
    const dayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santo_Domingo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(startedAt);
    const logDate = new Date(`${dayStr}T12:00:00Z`);
    const tariffSnapshot = Number(interpreter.tariffPerMinute);
    const callCost = Math.round((durationSeconds / 60) * tariffSnapshot * 100) / 100;

    if (
      interpreter.tariffPerMinute == null ||
      !Number.isFinite(tariffSnapshot) || tariffSnapshot < 0 ||
      !Number.isFinite(callCost) || callCost < 0 || callCost > MAX_DB_AMOUNT
    ) {
      return { success: false, error: 'Calculated call amount is outside the permitted range', code: 'VALIDATION_ERROR' };
    }

    const result = await db.$transaction(async (tx) => {
      const existingLog = await tx.productionLog.findFirst({
        where: { interpreterId, date: logDate },
      });
      if (existingLog?.isSettled) return { kind: 'SETTLED' as const };

      // A period can be financially immutable before payment occurs.
      // Match the reconciler's allow-list: only PENDING/Pendiente with no
      // paidAt can be changed. Check any explicit log/payroll link too.
      const lockedPayroll = await tx.payrollRecord.findFirst({
        where: {
          OR: [
            {
              interpreterId,
              periodStart: { lte: logDate },
              periodEnd: { gte: logDate },
            },
            ...(existingLog?.payrollRecordId
              ? [{ id: existingLog.payrollRecordId }]
              : []),
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

      const session = await tx.callSession.create({
        data: {
          interpreterId,
          startedAt,
          endedAt: now,
          durationSeconds,
          tariffSnapshot,
          callCost,
          notes: 'Quick log by interpreter',
        },
        select: { id: true },
      });

      let productionLogId: number;
      const minutes = Math.floor(durationSeconds / 60);
      if (existingLog) {
        await tx.productionLog.update({
          where: { id: existingLog.id, isSettled: false },
          data: {
            interpretedMinutes: (existingLog.interpretedMinutes || 0) + minutes,
            callsAttended: (existingLog.callsAttended || 0) + 1,
          },
        });
        productionLogId = existingLog.id;
      } else {
        const createdLog = await tx.productionLog.create({
          data: {
            interpreterId,
            date: logDate,
            interpretedMinutes: minutes,
            callsAttended: 1,
            status: 'Completed',
            observaciones: 'Quick log sync',
            adherence: 100,
          },
          select: { id: true },
        });
        productionLogId = createdLog.id;
      }

      // Persist provenance for every Quick Log within the same transaction.
      // Keep the existing business behavior: even a sub-minute Quick Log
      // increments callsAttended by 1, but contributes zero whole minutes.
      // A failed ledger insert rolls back the session and production write.
      await tx.callProductionEntry.create({
        data: {
          callSessionId: session.id,
          interpreterId,
          productionDate: logDate,
          interpretedMinutes: minutes,
          callsAttended: 1,
          productionLogId,
        },
      });

      return { kind: 'CREATED' as const, id: session.id };
    }, { isolationLevel: 'Serializable' });

    if (result.kind === 'LOCKED_PAYROLL') {
      return { success: false, error: 'This payroll period is approved, paid or otherwise locked and cannot be changed.', code: 'CONFLICT' };
    }
    if (result.kind === 'SETTLED') {
      return { success: false, error: 'This production log is already settled and cannot be changed.', code: 'CONFLICT' };
    }

    // The transaction already committed. Cache failures must never report a
    // completed call as unsaved, which can prompt a duplicate submission.
    try {
      revalidatePath('/dashboard');
      revalidateInterpreterProfileRecords(interpreterId);
    } catch (error) {
      console.warn('Quick Log saved; cache revalidation failed:', safeServerErrorCategory(error));
    }
    return { success: true, data: { id: result.id } };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: 'Invalid input data', code: 'VALIDATION_ERROR' };
    }
    // P2025: the conditional productionLog.update({ id, isSettled:false })
    // no longer matched, typically because the day settled/deleted after the
    // initial read. P2034: the serializable transaction was aborted by a race.
    // Neither is an unspecified server error and neither should invite a
    // blind retry of an accounting operation without checking the day.
    if (error && typeof error === 'object' && 'code' in error &&
        (error.code === 'P2025' || error.code === 'P2034')) {
      return {
        success: false,
        error: 'The production period changed or is locked. Review the call history before submitting again.',
        code: 'CONFLICT',
      };
    }
    console.error('quickLog failed:', safeServerErrorCategory(error));
    return { success: false, error: 'Failed to save quick log', code: 'INTERNAL_ERROR' };
  }
}
