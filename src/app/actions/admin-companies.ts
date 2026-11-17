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
 
// These calls happen only after Prisma has successfully committed a change.
// A cache refresh failure must not report "save failed" and trigger duplicate
// attempts; refresh other affected routes even if the first one fails.
function revalidateCommittedCompanyPaths(paths: readonly string[]) {
function refreshCompanyViews(paths: readonly string[]) {
  for (const path of paths) {
    try {
      revalidatePath(path);
    } catch (error) {
      console.warn('[COMPANIES] Cache refresh failed', safeServerErrorCategory(error));
    }
  }
}
      // Report only the category; framework/provider errors may include secrets.
      console.warn('[COMPANIES] Saved but cache refresh failed', safeServerErrorCategory(error));
    }
  }
}

export async function createCompany(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== 'admin') return { success: false, error: 'No autorizado.' };
  const parsed = schema.safeParse(Object.fromEntries(['name','legalName','contactEmail','billingEmail','country'].map(k => [k, formData.get(k) ?? ''])));
  if (!parsed.success) return { success: false, error: 'Datos de compañía inválidos.' };
  try {
    await prisma.company.create({ data: parsed.data });
    revalidateCommittedCompanyPaths(['/admin/companies']);
    return { success: true };
  } catch (error) {
    console.error('[COMPANIES] Create failed', safeServerErrorCategory(error));
    return { success: false, error: 'No se pudo registrar la compañía.' };
  }

  // Database write is already committed: a cache failure is not a save failure.
  refreshCompanyViews(['/admin/companies']);
  return { success: true };
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
    revalidateCommittedCompanyPaths(['/admin/companies', '/admin/accounts']);
    return { success: true };
  } catch (error) {
    console.error('[COMPANIES] Assign failed', safeServerErrorCategory(error));
    return { success: false, error: 'No se pudo vincular la cuenta.' };
  }

  refreshCompanyViews(['/admin/companies', '/admin/accounts']);
  return { success: true };
}
