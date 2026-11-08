'use server';

import { getCurrentProfile } from '@/app/actions/auth';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const AccountInput = z.object({
  clientId: z.coerce.number().int().positive(),
  name: z.string().trim().min(2).max(120),
  holderName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254),
  loginUrl: z.string().trim().url().refine(value => {
    try { return new URL(value).protocol === 'https:'; } catch { return false; }
  }),
  secretRef: z.string().trim().regex(/^vault:\/\/[a-zA-Z0-9/_-]{3,200}$/),
  description: z.string().trim().max(1000),
});

export async function createOperationalAccount(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== 'admin') return { success: false, error: 'Acceso no autorizado.' };
  const parsed = AccountInput.safeParse({
    clientId: formData.get('clientId'),
    name: formData.get('name'),
    holderName: formData.get('holderName'),
    email: formData.get('email'),
    loginUrl: formData.get('loginUrl'),
    secretRef: formData.get('secretRef'),
    description: formData.get('description') || '',
  });
  if (!parsed.success) return { success: false, error: 'Revisa los datos. La URL debe ser HTTPS y la contraseña debe estar referenciada en el gestor seguro (vault://).' };
  try {
    const client = await prisma.client.findFirst({
      where: { id: parsed.data.clientId, active: true },
      select: { id: true },
    });
    if (!client) return { success: false, error: 'El cliente seleccionado no existe o está inactivo.' };
    const { loginUrl, secretRef, ...accountData } = parsed.data;
    await prisma.account.create({
      data: {
        ...accountData,
        platforms: {
          create: {
            name: 'Plataforma principal',
            loginUrl,
            usernameHint: parsed.data.email,
            secretRef,
          },
        },
      },
    });
    revalidatePath('/admin/accounts');
    revalidatePath('/admin/clients');
    return { success: true };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      return { success: false, error: 'Ya existe una cuenta con ese nombre para este cliente.' };
    }
    console.error('[ADMIN_ACCOUNTS] Create failed', error);
    return { success: false, error: 'No se pudo crear la cuenta.' };
  }
}
