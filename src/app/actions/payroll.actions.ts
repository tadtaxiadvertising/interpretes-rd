'use server';

import prismaClient from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { validateAction } from '@/lib/auth/actions';

const prisma = prismaClient;

const MAX_DB_AMOUNT = 99_999_999.99;
const MAX_VERIFIED_MINUTES = 100_000;

function readText(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : null;
}

function parseMoney(value: string | null): number | null {
  if (value === null || !/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value)) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 && amount <= MAX_DB_AMOUNT
    ? Math.round(amount * 100) / 100
    : null;
}

function parseMinutes(value: string | null): number | null {
  if (value === null || !/^[1-9]\d{0,5}$/.test(value)) return null;
  const minutes = Number(value);
  return Number.isSafeInteger(minutes) && minutes <= MAX_VERIFIED_MINUTES ? minutes : null;
}

function isPaid(status: string | null): boolean {
  return status === 'Paid' || status === 'PAID';
}

function isValidAmount(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= MAX_DB_AMOUNT;
}

// Add incentives and penalties. Values are parsed strictly (no partial parseFloat,
// exponent notation, negative adjustments, NaN, or database-overflow amounts).
export async function updatePayrollAdjustments(_prevState: unknown, formData: FormData) {
  const authorization = await validateAction('admin');
  if ('error' in authorization) {
    return { success: false, error: authorization.error, code: authorization.code };
  }

  const id = readText(formData, 'id');
  const incentives = parseMoney(readText(formData, 'incentives'));
  const penalties = parseMoney(readText(formData, 'penalties'));

  if (!id || id.length > 128 || incentives === null || penalties === null) {
    return { success: false, error: 'Importe o identificador de nómina inválido', code: 'VALIDATION_ERROR' };
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const record = await tx.payrollRecord.findUnique({
        where: { id },
        select: {
          id: true, status: true, grossTotal: true, qualityBonus: true, transferDeduction: true,
        },
      });
      if (!record) return 'NOT_FOUND' as const;
      if (isPaid(record.status)) return 'PAID' as const;

      const netTotal = Math.max(
        0,
        Number(record.grossTotal) + Number(record.qualityBonus ?? 0) +
          incentives - penalties - Number(record.transferDeduction ?? 0),
      );
      if (!isValidAmount(netTotal)) return 'INVALID_TOTAL' as const;

      const result = await tx.payrollRecord.updateMany({
        where: { id, status: record.status, paidAt: null },
        data: { incentivesTotal: incentives, penalidades: penalties, netTotal },
      });
      return result.count === 1 ? 'UPDATED' as const : 'CONFLICT' as const;
    });

    if (updated !== 'UPDATED') {
      const errors = {
        NOT_FOUND: ['Registro de nómina no encontrado', 'NOT_FOUND'],
        PAID: ['La nómina ya fue pagada y no puede modificarse', 'CONFLICT'],
        INVALID_TOTAL: ['El total calculado excede el límite permitido', 'VALIDATION_ERROR'],
        CONFLICT: ['La nómina cambió durante la operación; vuelve a cargarla', 'CONFLICT'],
      } as const;
      const [error, code] = errors[updated];
      return { success: false, error, code };
    }

    revalidatePath('/payroll');
    return { success: true, message: 'Ajustes aplicados correctamente' };
  } catch (error) {
    console.error('updatePayrollAdjustments failed:', error instanceof Error ? error.message : 'Unknown error');
    return { success: false, error: 'No fue posible actualizar los ajustes', code: 'INTERNAL_ERROR' };
  }
}

// Verify minutes and recalculate gross/net totals with bounded integer input.
export async function verifyPayrollMinutes(_prevState: unknown, formData: FormData) {
  const authorization = await validateAction('admin');
  if ('error' in authorization) {
    return { success: false, error: authorization.error, code: authorization.code };
  }

  const id = readText(formData, 'id');
  const verifiedMinutes = parseMinutes(readText(formData, 'verifiedMinutes'));
  if (!id || id.length > 128 || verifiedMinutes === null) {
    return { success: false, error: 'Minutos o identificador de nómina inválido', code: 'VALIDATION_ERROR' };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const record = await tx.payrollRecord.findUnique({
        where: { id },
        include: { interpreter: { select: { tariffPerMinute: true } } },
      });
      if (!record || !record.interpreter) return 'NOT_FOUND' as const;
      if (isPaid(record.status) || record.paidAt) return 'PAID' as const;

      const tariff = Number(record.interpreter.tariffPerMinute);
      const grossTotal = Math.round(verifiedMinutes * tariff * 100) / 100;
      const netTotal = Math.max(
        0,
        grossTotal + Number(record.qualityBonus ?? 0) +
          Number(record.incentivesTotal ?? 0) - Number(record.penalidades ?? 0) -
          Number(record.transferDeduction ?? 0),
      );
      if (!isValidAmount(grossTotal) || !isValidAmount(netTotal)) return 'INVALID_TOTAL' as const;

      const updated = await tx.payrollRecord.updateMany({
        where: { id, status: record.status, paidAt: null },
        data: {
          verifiedMinutes,
          grossTotal,
          netTotal,
          status: 'Approved',
        },
      });
      return updated.count === 1 ? 'UPDATED' as const : 'CONFLICT' as const;
    });

    if (result !== 'UPDATED') {
      const errors = {
        NOT_FOUND: ['Nómina o intérprete no encontrado', 'NOT_FOUND'],
        PAID: ['La nómina ya fue pagada y no puede modificarse', 'CONFLICT'],
        INVALID_TOTAL: ['El total calculado excede el límite permitido', 'VALIDATION_ERROR'],
        CONFLICT: ['La nómina cambió durante la operación; vuelve a cargarla', 'CONFLICT'],
      } as const;
      const [error, code] = errors[result];
      return { success: false, error, code };
    }

    revalidatePath('/payroll');
    return { success: true, message: 'Minutos verificados y nómina aprobada' };
  } catch (error) {
    console.error('verifyPayrollMinutes failed:', error instanceof Error ? error.message : 'Unknown error');
    return { success: false, error: 'No fue posible verificar los minutos', code: 'INTERNAL_ERROR' };
  }
}

// Mark an approved payroll as paid exactly once. The status predicate is repeated
// in the write so concurrent requests cannot both complete the transition.
export async function markPayrollAsPaid(_prevState: unknown, formData: FormData) {
  const authorization = await validateAction('admin');
  if ('error' in authorization) {
    return { success: false, error: authorization.error, code: authorization.code };
  }

  const id = readText(formData, 'id');
  const transactionReference = readText(formData, 'transactionReference');
  if (
    !id || id.length > 128 ||
    !transactionReference ||
    transactionReference.length < 4 ||
    transactionReference.length > 100 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(transactionReference)
  ) {
    return { success: false, error: 'Referencia de transacción inválida', code: 'VALIDATION_ERROR' };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const record = await tx.payrollRecord.findUnique({
        where: { id },
        select: { id: true, status: true, paidAt: true, interpreter: { select: { metodoPago: true } } },
      });
      if (!record) return 'NOT_FOUND' as const;
      if (isPaid(record.status) || record.paidAt) return 'ALREADY_PAID' as const;
      if (record.status !== 'Approved') return 'NOT_APPROVED' as const;

      const method = (record.interpreter?.metodoPago || 'Unknown')
        .replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).toUpperCase() || 'UNKNOWN';
      const reconciliationHash = `PAY-${id.slice(0, 12)}-${method}-${transactionReference}`;
      const paidAt = new Date();
      const updated = await tx.payrollRecord.updateMany({
        where: { id, status: 'Approved', paidAt: null },
        data: {
          status: 'Paid',
          paidAt,
          paymentDate: paidAt,
          transactionReference,
          reconciliationHash,
        },
      });
      return updated.count === 1 ? 'PAID' as const : 'CONFLICT' as const;
    });

    if (result !== 'PAID') {
      const errors = {
        NOT_FOUND: ['Registro de nómina no encontrado', 'NOT_FOUND'],
        ALREADY_PAID: ['La nómina ya fue pagada', 'CONFLICT'],
        NOT_APPROVED: ['La nómina debe estar aprobada antes de pagar', 'CONFLICT'],
        CONFLICT: ['La nómina cambió durante la operación; vuelve a cargarla', 'CONFLICT'],
      } as const;
      const [error, code] = errors[result];
      return { success: false, error, code };
    }

    revalidatePath('/payroll');
    return { success: true, message: 'Nómina marcada como pagada' };
  } catch (error) {
    console.error('markPayrollAsPaid failed:', error instanceof Error ? error.message : 'Unknown error');
    return { success: false, error: 'No fue posible registrar el pago', code: 'INTERNAL_ERROR' };
  }
}
