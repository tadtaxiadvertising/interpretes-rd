'use server';

import prisma from '@/lib/prisma';
import { revalidateInterpreterProfileRecords } from '@/lib/cache/revalidate-interpreter';
import { validateAction } from '@/lib/auth/actions';
import type { ActionResult } from '@/lib/types';
import { refreshPayrollRecord } from '@/services/PayrollService';
import { z } from 'zod';

const db = prisma;

const ProductionDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format')
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Invalid calendar date')
  .transform((value) => new Date(`${value}T12:00:00Z`));

const ProductionLogSchema = z.object({
  date: ProductionDateSchema,
  interpretedMinutes: z.coerce.number().int().positive().max(100_000),
  callsAttended: z.coerce.number().int().nonnegative().max(10_000).default(0),
  observations: z.string().trim().max(1_000).optional(),
});

export async function createInterpreterLog(formData: FormData): Promise<ActionResult> {
  const auth = await validateAction('interpreter');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  const interpreterId = auth.profile.interpreterId;
  if (!interpreterId) {
    return { success: false, error: 'User not linked to an interpreter profile', code: 'BAD_REQUEST' };
  }

  try {
    const rawData = {
      date: formData.get('date'),
      interpretedMinutes: formData.get('interpretedMinutes') || formData.get('minutes'),
      callsAttended: formData.get('callsAttended') || formData.get('calls') || 0,
      observations: formData.get('observations') || undefined,
    };
    const validated = ProductionLogSchema.parse(rawData);

    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (validated.date > today) {
      return { success: false, error: 'Cannot log production for future dates', code: 'VALIDATION_ERROR' };
    }

    const result = await db.$transaction(async (tx) => {
      const paidPayroll = await tx.payrollRecord.findFirst({
        where: {
          interpreterId,
          status: { in: ['PAID', 'Paid'] },
          periodStart: { lte: validated.date },
          periodEnd: { gte: validated.date },
        },
        select: { id: true },
      });
      if (paidPayroll) return { kind: 'PAID' as const };

      const existingLog = await tx.productionLog.findFirst({
        where: { interpreterId, date: validated.date },
        select: { id: true },
      });
      if (existingLog) return { kind: 'EXISTS' as const };

      const created = await tx.productionLog.create({
        data: {
          interpreterId,
          date: validated.date,
          interpretedMinutes: validated.interpretedMinutes,
          callsAttended: validated.callsAttended,
          status: 'Completed',
          observaciones: validated.observations,
          adherence: 100,
        },
        select: { id: true },
      });
      return { kind: 'CREATED' as const, id: created.id };
    }, { isolationLevel: 'Serializable' });

    if (result.kind === 'PAID') {
      return { success: false, error: 'This production period has already been paid and cannot be changed.', code: 'CONFLICT' };
    }
    if (result.kind === 'EXISTS') {
      return {
        success: false,
        error: 'A log already exists for this date. Please contact an admin to modify it.',
        code: 'CONFLICT',
      };
    }

    await refreshPayrollRecord(interpreterId, validated.date);
    revalidateInterpreterProfileRecords(interpreterId);
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: 'Datos de registro inválidos', code: 'VALIDATION_ERROR' };
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034') {
      return { success: false, error: 'The production record changed concurrently. Please retry.', code: 'CONFLICT' };
    }
    console.error('createInterpreterLog failed:', error instanceof Error ? error.message : 'Unknown error');
    return { success: false, error: 'Failed to create log', code: 'INTERNAL_ERROR' };
  }
}
