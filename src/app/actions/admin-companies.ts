'use server';

import { getCurrentProfile } from '@/app/actions/auth';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

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
    // A successful database commit must not be reported as a failed save
    // if cache invalidation subsequently fails.
    try {
      revalidatePath('/admin/companies');
    } catch (cacheError) {
      console.warn('[COMPANIES] Saved but cache refresh failed:', safeServerErrorCategory(cacheError));
    }
    return { success: true };
  } catch (error) {
    console.error('[COMPANIES] Create failed', safeServerErrorCategory(error));
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
    // Attempt each refresh independently; neither can undo the committed update.
    for (const path of ['/admin/companies', '/admin/accounts']) {
      try {
        revalidatePath(path);
      } catch (cacheError) {
        console.warn('[COMPANIES] Assigned but cache refresh failed:', safeServerErrorCategory(cacheError));
      }
    }
    return { success: true };
  } catch (error) {
    console.error('[COMPANIES] Assign failed', safeServerErrorCategory(error));
    return { success: false, error: 'No se pudo vincular la cuenta.' };
  }
}
