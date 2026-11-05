'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ActionResult } from '@/lib/types';
import { Account, InterpreterAccountRate } from '@prisma/client';
import { validateAction } from '@/lib/auth/actions';
import { operationalAccountInputSchema } from '@/lib/client-validation';

const db = prisma;

export async function createAccount(name: string, description: string | undefined, clientId: number): Promise<ActionResult<Account & { clientName: string }>> {
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
    revalidatePath('/admin/payrates');
    revalidatePath('/admin/accounts');
    revalidatePath('/admin/clients');
    revalidatePath('/settings');
    return { success: true, data: { ...account, clientName: account.client.name } };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      return { success: false, error: 'La cuenta ya existe', code: 'CONFLICT' };
    }
    return { success: false, error: 'Error al crear la cuenta', code: 'INTERNAL_ERROR' };
  }
}

export async function updateAccount(id: number, name: string, description?: string): Promise<ActionResult<Account>> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    const account = await db.account.update({
      where: { id },
      data: { name, description },
      select: { id: true, name: true, description: true }
    });
    revalidatePath('/admin/payrates');
    revalidatePath('/settings');
    return { success: true, data: account as Account };
  } catch {
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
    revalidatePath('/admin/payrates');
    revalidatePath('/settings');
    return { success: true };
  } catch {
    return { success: false, error: 'Error al eliminar la cuenta (puede tener registros asociados)', code: 'INTERNAL_ERROR' };
  }
}

export async function getAccounts(): Promise<ActionResult<Account[]>> {
  const auth = await validateAction();
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    const accounts = await db.account.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, description: true }
    });
    return { success: true, data: accounts as Account[] };
  } catch (error) {
    console.error('Error fetching accounts:', error instanceof Error ? error.message : 'Unknown error');
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

  try {
    // ── Execute in Transaction ──────────────────────────
    const result = await db.$transaction(async (tx) => {
      // 1. Get old rate for audit
      const oldRate = await tx.interpreterAccountRate.findUnique({
        where: {
          interpreterId_accountId: { interpreterId, accountId }
        },
        select: { tariffPerHour: true }
      });

      // 2. Upsert the rate
      const rate = await tx.interpreterAccountRate.upsert({
        where: {
          interpreterId_accountId: { interpreterId, accountId },
        },
        update: { tariffPerHour },
        create: { interpreterId, accountId, tariffPerHour },
        select: { 
          id: true,
          interpreterId: true, 
          accountId: true, 
          tariffPerHour: true,
          createdAt: true,
          updatedAt: true 
        }
      });

      // 3. Create Audit Log
      await tx.payrateAuditLog.create({
        data: {
          interpreterId,
          oldRate: oldRate?.tariffPerHour,
          newRate: tariffPerHour,
          changedBy: auth.user.userId
        },
        select: { id: true }
      });

      return rate;
    });

    revalidatePath('/admin/payrates');
    return { success: true, data: result as InterpreterAccountRate };
  } catch (error) {
    console.error('Error setting account rate:', error);
    return { success: false, error: 'Error setting account rate', code: 'INTERNAL_ERROR' };
  }
}

export async function deleteInterpreterAccountRate(
  interpreterId: number,
  accountId: number
): Promise<ActionResult<void>> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    await db.interpreterAccountRate.delete({
      where: {
        interpreterId_accountId: { interpreterId, accountId },
      },
      select: { interpreterId: true }
    });

    revalidatePath('/admin/payrates');
    return { success: true };
  } catch (error) {
    console.error('Error deleting account rate:', error);
    return { success: false, error: 'Error deleting account rate', code: 'INTERNAL_ERROR' };
  }
}
