'use server';

import { getCurrentProfile } from '@/app/actions/auth';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const AccountInput = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
});

export async function createOperationalAccount(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== 'admin') {
    return { success: false, error: 'Acceso no autorizado.' };
  }
  const parsed = AccountInput.safeParse({
    name: formData.get('name'),
    description: formData.get('description') || '',
  });
  if (!parsed.success) return { success: false, error: 'Revisa el nombre y la descripción.' };
  try {
    await prisma.account.create({ data: parsed.data });
    revalidatePath('/admin/accounts');
    return { success: true };
  } catch (error) {
    console.error('[ADMIN_ACCOUNTS] Create failed', error);
    return { success: false, error: 'No se pudo crear la cuenta. Comprueba que el nombre no exista.' };
  }
}
