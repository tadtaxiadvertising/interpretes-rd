'use server';

import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { notifyPayrateChange } from '@/lib/notifications/notify-payrate';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';
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
    return { success: false, error: 'La tarifa por minuto debe estar entre RD$0.01 y RD$999.99.', code: 'VALIDATION_ERROR' };
  }

  const effectiveRate = new Prisma.Decimal(parsed.data.newRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  try {
    const result = await db.$transaction(async (tx) => {
      const interpreter = await tx.interpreter.findUnique({
        where: { id: parsed.data.interpreterId },
        select: { tariffPerMinute: true },
      });

      if (!interpreter) return null;

      const oldRate = Number(interpreter.tariffPerMinute);
      const savedRate = effectiveRate.toNumber();
      if (effectiveRate.equals(interpreter.tariffPerMinute)) return { oldRate, newRate: savedRate, auditId: null };
      await tx.interpreter.update({
        where: { id: parsed.data.interpreterId },
        data: { tariffPerMinute: effectiveRate },
        select: { id: true },
      });
      const audit = await tx.payrateAuditLog.create({
        data: {
          interpreterId: parsed.data.interpreterId,
          oldRate,
          newRate: effectiveRate,
          changedBy: auth.user.userId,
        },
        select: { id: true },
      });

      return { oldRate, newRate: savedRate, auditId: audit.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (!result) {
      return { success: false, error: 'No se encontró el intérprete.', code: 'NOT_FOUND' };
    }

    try { revalidateInterpreterProfileRecords(parsed.data.interpreterId); }
    catch (error) { console.warn('[PAYRATES] Saved but cache refresh failed:', safeServerErrorCategory(error)); }
    if (result.auditId !== null) await notifyPayrateChange({ interpreterId: parsed.data.interpreterId, auditId: result.auditId, kind: 'general' });
    return { success: true, data: { oldRate: result.oldRate, newRate: result.newRate } };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') {
      return { success: false, error: 'Otra operación modificó las tarifas. Actualiza la página y verifica el valor antes de repetir.', code: 'CONFLICT' };
    }
    console.error('[PAYRATES] Update failed:', safeServerErrorCategory(error));
    return { success: false, error: 'No se pudo confirmar la actualización de la tarifa. Verifica el valor registrado.', code: 'SERVICE_UNAVAILABLE' };
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
    console.error('[PAYRATES] History failed:', safeServerErrorCategory(error));
    return { success: false, error: 'Unable to load payrate history', code: 'SERVICE_UNAVAILABLE' };
  }
}
