'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ActionResult } from '@/lib/types';
import { Account, InterpreterAccountRate } from '@prisma/client';
import { z } from 'zod';
import { validateAction } from '@/lib/auth/actions';
import { operationalAccountInputSchema } from '@/lib/client-validation';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

const db = prisma;

// Revalidation runs after a committed database write. Do not report a saved
// account or rate change as failed: retrying could duplicate financial audits.
function refreshAccountRateViews(paths: readonly string[]) {
  for (const path of paths) {
    try {
      revalidatePath(path);
    } catch (error) {
      // Errors from frameworks/providers can include database URLs or PII.
      console.warn('[ACCOUNT_RATES] Saved but cache refresh failed:', safeServerErrorCategory(error));
    }
  }
}
const accountRateInputSchema = z.object({
  interpreterId: z.number().int().positive(),
  accountId: z.number().int().positive(),
  tariffPerHour: z.number().finite().positive().max(99999),
});
type ManagedAccount = Pick<Account, 'id' | 'name' | 'description' | 'clientId'> & { clientName: string | null };
export type AccountOption = Pick<Account, 'id' | 'name'> & {
  client: { name: string } | null;
  company: { name: string } | null;
};

export async function createAccount(name: string, description: string | undefined, clientId: number): Promise<ActionResult<ManagedAccount>> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  const parsed = operationalAccountInputSchema.safeParse({ clientId, name, description: description ?? '' });
  if (!parsed.success) return { success: false, error: 'Selecciona un cliente y revisa los datos de la cuenta.', code: 'VALIDATION_ERROR' };

  try {
    const client = await db.client.findFirst({ where: { id: parsed.data.clientId, active: true }, select: { id: true, name: true } });
    if (!client) return { success: false, error: 'El cliente seleccionado no existe o está inactivo.', code: 'VALIDATION_ERROR' };
    const account = await db.account.create({
      data: { name: parsed.data.name, description: parsed.data.description || null, clientId: client.id },
      select: { id: true, name: true, description: true, clientId: true, client: { select: { name: true } } }
    });
    refreshAccountRateViews(['/admin/payrates', '/admin/accounts', '/admin/clients', '/settings']);
    return { success: true, data: { ...account, clientName: client.name } };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      return { success: false, error: 'Ya existe una cuenta con ese nombre para este cliente.', code: 'CONFLICT' };
    }
    return { success: false, error: 'Error al crear la cuenta', code: 'INTERNAL_ERROR' };
  }
}

export async function updateAccount(id: number, name: string, description?: string): Promise<ActionResult<ManagedAccount>> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  const parsed = z.object({
    id: z.number().int().positive(),
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000).optional(),
  }).safeParse({ id, name, description: description ?? '' });
  if (!parsed.success) {
    return { success: false, error: 'Revisa el nombre y la descripción de la cuenta.', code: 'VALIDATION_ERROR' };
  }

  try {
    const account = await db.account.update({
      where: { id: parsed.data.id },
      data: { name: parsed.data.name, description: parsed.data.description || null },
      select: { id: true, name: true, description: true, clientId: true, client: { select: { name: true } } }
    });
    refreshAccountRateViews(['/admin/payrates', '/admin/accounts', '/admin/clients', '/settings']);
    return { success: true, data: { ...account, clientName: account.client?.name ?? null } };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      return { success: false, error: 'Ya existe una cuenta con ese nombre para este cliente.', code: 'CONFLICT' };
    }
    return { success: false, error: 'Error al actualizar la cuenta', code: 'INTERNAL_ERROR' };
  }
}

export async function deleteAccount(id: number): Promise<ActionResult<void>> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    await db.account.delete({
      where: { id },
      select: { id: true }
    });
    refreshAccountRateViews(['/admin/payrates', '/admin/accounts', '/admin/clients', '/settings']);
    return { success: true };
  } catch {
    return { success: false, error: 'Error al eliminar la cuenta (puede tener registros asociados)', code: 'INTERNAL_ERROR' };
  }
}

export async function getAccounts(): Promise<ActionResult<AccountOption[]>> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    const accounts = await db.account.findMany({
      orderBy: [{ client: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        client: { select: { name: true } },
        company: { select: { name: true } },
      }
    });
    return { success: true, data: accounts };
  } catch (error) {
    console.error('[ACCOUNT_RATES] Fetch failed:', safeServerErrorCategory(error));
    return { success: false, error: 'Error fetching accounts', code: 'INTERNAL_ERROR' };
  }
}

export async function setInterpreterAccountRate(
  interpreterId: number,
  accountId: number,
  tariffPerHour: number
): Promise<ActionResult<InterpreterAccountRate>> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };
  const parsed = accountRateInputSchema.safeParse({ interpreterId, accountId, tariffPerHour });
  if (!parsed.success) return { success: false, error: 'Revisa el intérprete, la cuenta y la tarifa.', code: 'VALIDATION_ERROR' };

  try {
    const result = await db.$transaction(async (tx) => {
      const oldRate = await tx.interpreterAccountRate.findUnique({
        where: { interpreterId_accountId: { interpreterId: parsed.data.interpreterId, accountId: parsed.data.accountId } },
        select: { tariffPerHour: true }
      });
      const rate = await tx.interpreterAccountRate.upsert({
        where: { interpreterId_accountId: { interpreterId: parsed.data.interpreterId, accountId: parsed.data.accountId } },
        update: { tariffPerHour: parsed.data.tariffPerHour },
        create: parsed.data,
        select: { id: true, interpreterId: true, accountId: true, tariffPerHour: true, createdAt: true, updatedAt: true }
      });
      await tx.payrateAuditLog.create({
        data: { interpreterId: parsed.data.interpreterId, oldRate: oldRate?.tariffPerHour, newRate: parsed.data.tariffPerHour, changedBy: auth.user.userId },
        select: { id: true }
      });
      return rate;
    });
    refreshAccountRateViews(['/admin/payrates']);
    return { success: true, data: result as InterpreterAccountRate };
  } catch (error) {
    console.error('[ACCOUNT_RATES] Rate update failed:', safeServerErrorCategory(error));
    return { success: false, error: 'Error setting account rate', code: 'INTERNAL_ERROR' };
  }
}

export async function deleteInterpreterAccountRate(
  interpreterId: number,
  accountId: number
): Promise<ActionResult<void>> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };
  const parsed = z.object({ interpreterId: z.number().int().positive(), accountId: z.number().int().positive() }).safeParse({ interpreterId, accountId });
  if (!parsed.success) return { success: false, error: 'Selecciona un intérprete y una cuenta válidos.', code: 'VALIDATION_ERROR' };

  try {
    await db.interpreterAccountRate.delete({
      where: { interpreterId_accountId: { interpreterId: parsed.data.interpreterId, accountId: parsed.data.accountId } },
      select: { interpreterId: true }
    });
    refreshAccountRateViews(['/admin/payrates']);
    return { success: true };
  } catch (error) {
    console.error('[ACCOUNT_RATES] Rate delete failed:', safeServerErrorCategory(error));
    return { success: false, error: 'Error deleting account rate', code: 'INTERNAL_ERROR' };
  }
}
