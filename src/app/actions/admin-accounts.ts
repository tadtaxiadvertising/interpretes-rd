'use server';

import { getCurrentProfile } from '@/app/actions/auth';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const AccountInput = z.object({
  clientId: z.coerce.number().int().positive(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000),
});

export async function createOperationalAccount(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== 'admin') return { success: false, error: 'Acceso no autorizado.' };
  const parsed = AccountInput.safeParse({
    clientId: formData.get('clientId'),
    name: formData.get('name'),
    description: formData.get('description') || '',
  });
  if (!parsed.success) return { success: false, error: 'Selecciona un cliente y revisa el nombre y la descripción.' };
  try {
    const client = await prisma.client.findFirst({
      where: { id: parsed.data.clientId, active: true },
      select: { id: true },
    });
    if (!client) return { success: false, error: 'El cliente seleccionado no existe o está inactivo.' };
    await prisma.account.create({ data: parsed.data });
    revalidatePath('/admin/accounts');
    revalidatePath('/admin/clients');
    return { success: true };
  } catch (error) {
    console.error('[ADMIN_ACCOUNTS] Create failed', error);
    return { success: false, error: 'No se pudo crear la cuenta. Comprueba que el nombre no exista.' };
  }
}
