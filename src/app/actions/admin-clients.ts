'use server';

import { getCurrentProfile } from '@/app/actions/auth';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { clientAssignmentSchema, clientInputSchema } from '@/lib/client-validation';

export async function createClient(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== 'admin') return { success: false, error: 'No autorizado.' };
  const parsed = clientInputSchema.safeParse(Object.fromEntries(
    ['name', 'legalName', 'contactName', 'contactEmail', 'phone', 'notes']
      .map(key => [key, formData.get(key) ?? '']),
  ));
  if (!parsed.success) return { success: false, error: 'Datos del cliente inválidos.' };
  try {
    await prisma.client.create({ data: parsed.data });
    revalidatePath('/admin/clients');
    revalidatePath('/admin/accounts');
    return { success: true };
  } catch (error) {
    console.error('[CLIENTS] Create failed', error);
    return { success: false, error: 'No se pudo registrar el cliente. Comprueba que no exista.' };
  }
}

export async function assignAccountToClient(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== 'admin') return { success: false, error: 'No autorizado.' };
  const parsed = clientAssignmentSchema.safeParse({
    accountId: formData.get('accountId'),
    clientId: formData.get('clientId'),
  });
  if (!parsed.success) return { success: false, error: 'Selecciona una cuenta y un cliente válidos.' };
  try {
    const client = await prisma.client.findFirst({
      where: { id: parsed.data.clientId, active: true },
      select: { id: true },
    });
    if (!client) return { success: false, error: 'El cliente no existe o está inactivo.' };
    const result = await prisma.account.updateMany({
      where: { id: parsed.data.accountId, clientId: null },
      data: { clientId: client.id },
    });
    if (result.count !== 1) {
      return { success: false, error: 'La cuenta no existe o ya pertenece a un cliente. No se modificó su historial.' };
    }
    for (const path of ['/admin/clients', '/admin/accounts', '/admin/assignments', '/admin/reports', '/admin/reconciliation', '/admin/platforms']) {
      revalidatePath(path);
    }
    return { success: true };
  } catch (error) {
    console.error('[CLIENTS] Account assignment failed', error);
    return { success: false, error: 'No se pudo vincular la cuenta al cliente.' };
  }
}
