'use server';

import { getCurrentProfile } from '@/app/actions/auth';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const schema = z.object({
  name: z.string().trim().min(2).max(150),
  legalName: z.string().trim().max(200).optional(),
  contactEmail: z.union([z.literal(''), z.email()]).optional(),
  billingEmail: z.union([z.literal(''), z.email()]).optional(),
  country: z.string().trim().max(100).optional(),
});
export async function createCompany(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== 'admin') return { success: false, error: 'No autorizado.' };
  const parsed = schema.safeParse(Object.fromEntries(['name','legalName','contactEmail','billingEmail','country'].map(k => [k, formData.get(k) ?? ''])));
  if (!parsed.success) return { success: false, error: 'Datos de compañía inválidos.' };
  try {
    await prisma.company.create({ data: parsed.data });
    revalidatePath('/admin/companies');
    return { success: true };
  } catch (error) {
    console.error('[COMPANIES] Create failed', error);
    return { success: false, error: 'No se pudo registrar la compañía.' };
  }
}

export async function assignAccountToCompany(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== 'admin') return { success: false, error: 'No autorizado.' };
  const accountId = Number(formData.get('accountId'));
  const companyId = Number(formData.get('companyId'));
  if (!Number.isSafeInteger(accountId) || accountId <= 0 || !Number.isSafeInteger(companyId) || companyId <= 0) {
    return { success: false, error: 'Selección inválida.' };
  }
  try {
    await prisma.account.update({ where: { id: accountId }, data: { companyId } });
    revalidatePath('/admin/companies');
    revalidatePath('/admin/accounts');
    return { success: true };
  } catch (error) {
    console.error('[COMPANIES] Assign failed', error);
    return { success: false, error: 'No se pudo vincular la cuenta.' };
  }
}
