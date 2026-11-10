'use server';

import prisma from '@/lib/prisma';
import type { ActionResult } from '@/lib/types';
import { validateAction } from '@/lib/auth/actions';
import { revalidateInterpreterProfileRecords } from '@/lib/cache/revalidate-interpreter';
import { z } from 'zod';

const db = prisma;

const UpdatePayrateSchema = z.object({
  interpreterId: z.number().int().positive(),
  newRate: z.number().finite().min(0.01).max(999.99),
});

const InterpreterIdSchema = z.number().int().positive();

export async function updatePayrate(
  interpreterId: number,
  newRate: number
): Promise<ActionResult<{ oldRate: number; newRate: number }>> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  const parsed = UpdatePayrateSchema.safeParse({ interpreterId, newRate });
  if (!parsed.success) {
    return { success: false, error: 'Rate must be between $0.01 and $999.99', code: 'VALIDATION_ERROR' };
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const interpreter = await tx.interpreter.findUnique({
        where: { id: parsed.data.interpreterId },
        select: { tariffPerMinute: true },
      });

      if (!interpreter) return null;

      const oldRate = Number(interpreter.tariffPerMinute);
      await tx.interpreter.update({
        where: { id: parsed.data.interpreterId },
        data: { tariffPerMinute: parsed.data.newRate },
        select: { id: true },
      });
      await tx.payrateAuditLog.create({
        data: {
          interpreterId: parsed.data.interpreterId,
          oldRate,
          newRate: parsed.data.newRate,
          changedBy: auth.user.userId,
        },
        select: { id: true },
      });

      return { oldRate, newRate: parsed.data.newRate };
    });

    if (!result) {
      return { success: false, error: 'Interpreter not found', code: 'NOT_FOUND' };
    }

    revalidateInterpreterProfileRecords(parsed.data.interpreterId);
    return { success: true, data: result };
  } catch (error) {
    console.error('Error updating payrate:', error instanceof Error ? error.message : 'Unknown error');
    return { success: false, error: 'Unable to update payrate', code: 'SERVICE_UNAVAILABLE' };
  }
}

export async function getPayrateHistory(
  interpreterId: number
): Promise<ActionResult<unknown[]>> {
  const auth = await validateAction(['admin', 'interpreter']);
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  const parsedId = InterpreterIdSchema.safeParse(interpreterId);
  if (!parsedId.success) {
    return { success: false, error: 'Invalid interpreter', code: 'VALIDATION_ERROR' };
  }

  // Financial history is visible to administrators and to the interpreter
  // whose own profile is linked to the requested interpreter.
  if (auth.user.role !== 'admin' && auth.user.interpreterId !== parsedId.data) {
    return { success: false, error: 'Access denied', code: 'UNAUTHORIZED' };
  }

  try {
    const history = await db.payrateAuditLog.findMany({
      where: { interpreterId: parsedId.data },
      orderBy: { changedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        oldRate: true,
        newRate: true,
        changedAt: true,
        changedBy: true,
      },
    });

    return { success: true, data: history ?? [] };
  } catch (error) {
    console.error('Error fetching payrate history:', error instanceof Error ? error.message : 'Unknown error');
    return { success: false, error: 'Unable to load payrate history', code: 'SERVICE_UNAVAILABLE' };
  }
}
