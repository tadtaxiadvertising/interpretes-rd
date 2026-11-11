'use server';

import { getCurrentProfile } from '@/app/actions/auth';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { safeHttpsUrl } from '@/lib/platform-input-security';

const AccountInput = z.object({
  clientId: z.coerce.number().int().positive(),
  companyId: z.union([z.literal(''), z.coerce.number().int().positive()]),
  name: z.string().trim().min(2).max(120),
  holderName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254),
  loginUrl: z.string().trim().url().refine(value => safeHttpsUrl.safeParse(value).success, {
    message: 'La URL debe ser HTTPS y no contener credenciales, tokens ni fragmentos.',
  }),
  secretRef: z.string().trim().regex(/^vault:\/\/[a-zA-Z0-9/_-]{3,200}$/),
  description: z.string().trim().max(1000),
});

export async function createOperationalAccount(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== 'admin') return { success: false, error: 'Acceso no autorizado.' };
  const parsed = AccountInput.safeParse({
    clientId: formData.get('clientId'),
    companyId: formData.get('companyId') || '',
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
    const { loginUrl, secretRef, companyId, ...accountData } = parsed.data;
    if (companyId) {
      const company = await prisma.company.findFirst({ where: { id: Number(companyId), active: true }, select: { id: true } });
      if (!company) return { success: false, error: 'La compañía seleccionada no existe o está inactiva.' };
    }
    await prisma.account.create({
      data: {
        ...accountData,
        companyId: companyId ? Number(companyId) : null,
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


const UpdateAccountInput = AccountInput.extend({
  accountId: z.coerce.number().int().positive(),
});

export async function updateOperationalAccount(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== 'admin') return { success: false, error: 'Acceso no autorizado.' };

  const parsed = UpdateAccountInput.safeParse({
    accountId: formData.get('accountId'),
    clientId: formData.get('clientId'),
    companyId: formData.get('companyId') || '',
    name: formData.get('name'),
    holderName: formData.get('holderName'),
    email: formData.get('email'),
    loginUrl: formData.get('loginUrl'),
    secretRef: formData.get('secretRef'),
    description: formData.get('description') || '',
  });
  if (!parsed.success) {
    return { success: false, error: 'Revisa los datos. La URL debe ser HTTPS y la contraseña debe estar referenciada en el gestor seguro (vault://).' };
  }

  try {
    const { accountId, loginUrl, secretRef, companyId, ...accountData } = parsed.data;
    const [account, client, company] = await Promise.all([
      prisma.account.findUnique({ where: { id: accountId }, select: { id: true } }),
      prisma.client.findFirst({ where: { id: accountData.clientId, active: true }, select: { id: true } }),
      companyId
        ? prisma.company.findFirst({ where: { id: Number(companyId), active: true }, select: { id: true } })
        : Promise.resolve(null),
    ]);
    if (!account) return { success: false, error: 'La cuenta ya no existe.' };
    if (!client) return { success: false, error: 'El cliente seleccionado no existe o está inactivo.' };
    if (companyId && !company) return { success: false, error: 'La compañía seleccionada no existe o está inactiva.' };

    await prisma.$transaction(async tx => {
      await tx.account.update({
        where: { id: accountId },
        data: { ...accountData, companyId: companyId ? Number(companyId) : null },
      });
      const platform = await tx.accountPlatform.findFirst({
        where: { accountId, name: 'Plataforma principal' },
        select: { id: true },
      });
      if (platform) {
        await tx.accountPlatform.update({
          where: { id: platform.id },
          data: { loginUrl, usernameHint: accountData.email, secretRef, active: true },
        });
      } else {
        await tx.accountPlatform.create({
          data: { accountId, name: 'Plataforma principal', loginUrl, usernameHint: accountData.email, secretRef },
        });
      }
    });

    revalidatePath('/admin/accounts');
    revalidatePath('/admin/clients');
    return { success: true };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      return { success: false, error: 'Ya existe una cuenta con ese nombre para este cliente.' };
    }
    console.error('[ADMIN_ACCOUNTS] Update failed', error);
    return { success: false, error: 'No se pudo actualizar la cuenta.' };
  }
}
