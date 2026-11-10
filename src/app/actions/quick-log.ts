'use server';

import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import type { ActionResult } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { revalidateInterpreterProfileRecords } from '@/lib/cache/revalidate-interpreter';
import { z } from 'zod';

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
    const dayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santo_Domingo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    const logDate = new Date(`${dayStr}T12:00:00Z`);
    const startedAt = new Date(now.getTime() - durationSeconds * 1000);
    const tariffSnapshot = Number(interpreter.tariffPerMinute);
    const callCost = Math.round((durationSeconds / 60) * tariffSnapshot * 100) / 100;

    if (
      !Number.isFinite(tariffSnapshot) || tariffSnapshot < 0 ||
      !Number.isFinite(callCost) || callCost < 0 || callCost > MAX_DB_AMOUNT
    ) {
      return { success: false, error: 'Calculated call amount is outside the permitted range', code: 'VALIDATION_ERROR' };
    }

    const result = await db.$transaction(async (tx) => {
      const paidPayroll = await tx.payrollRecord.findFirst({
        where: {
          interpreterId,
          status: { in: ['PAID', 'Paid'] },
          periodStart: { lte: logDate },
          periodEnd: { gte: logDate },
        },
        select: { id: true },
      });
      if (paidPayroll) return { kind: 'PAID' as const };

      const existingLog = await tx.productionLog.findFirst({
        where: { interpreterId, date: logDate },
      });
      if (existingLog?.isSettled) return { kind: 'SETTLED' as const };

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

      if (existingLog) {
        await tx.productionLog.update({
          where: { id: existingLog.id, isSettled: false },
          data: {
            interpretedMinutes: (existingLog.interpretedMinutes || 0) + Math.floor(durationSeconds / 60),
            callsAttended: (existingLog.callsAttended || 0) + 1,
          },
        });
      } else {
        await tx.productionLog.create({
          data: {
            interpreterId,
            date: logDate,
            interpretedMinutes: Math.floor(durationSeconds / 60),
            callsAttended: 1,
            status: 'Completed',
            observaciones: 'Quick log sync',
            adherence: 100,
          },
        });
      }

      return { kind: 'CREATED' as const, id: session.id };
    }, { isolationLevel: 'Serializable' });

    if (result.kind === 'PAID') {
      return { success: false, error: 'This production period has already been paid and cannot be changed.', code: 'CONFLICT' };
    }
    if (result.kind === 'SETTLED') {
      return { success: false, error: 'This production log is already settled and cannot be changed.', code: 'CONFLICT' };
    }

    revalidatePath('/dashboard');
    revalidateInterpreterProfileRecords(interpreterId);
    return { success: true, data: { id: result.id } };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: 'Invalid input data', code: 'VALIDATION_ERROR' };
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034') {
      return { success: false, error: 'The production period changed concurrently. Please retry.', code: 'CONFLICT' };
    }
    console.error('quickLog failed:', error instanceof Error ? error.message : 'Unknown error');
    return { success: false, error: 'Failed to save quick log', code: 'INTERNAL_ERROR' };
  }
}
