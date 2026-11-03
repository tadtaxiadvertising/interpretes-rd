'use server';

import { getCurrentProfile } from '@/app/actions/auth';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const rejectCredentialLikeText = (value: string) => !/(?:password|passwd|pwd|api[_ -]?key|access[_ -]?token|secret|bearer|authorization)\s*[:=]/i.test(value);

const safeHttpsUrl = z.string().refine(value => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash &&
      ![...url.searchParams.keys()].some(key => /(?:token|secret|password|passwd|pwd|api.?key|auth|credential)/i.test(key));
  } catch { return false; }
}, 'URL HTTPS sin credenciales ni tokens requerida');

const schema = z.object({
  accountId: z.coerce.number().int().positive(),
  name: z.string().trim().min(2).max(120),
  loginUrl: safeHttpsUrl,
  usernameHint: z.string().trim().max(150).refine(rejectCredentialLikeText),
  secretRef: z.union([z.literal(''), z.string().trim().regex(/^vault:\/\/[a-zA-Z0-9/_-]{3,200}$/)]),
  notes: z.string().trim().max(500).refine(rejectCredentialLikeText),
});

export async function createAccountPlatform(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== 'admin') return { success: false, error: 'No autorizado.' };
  const parsed = schema.safeParse(Object.fromEntries(['accountId','name','loginUrl','usernameHint','secretRef','notes'].map(k => [k, formData.get(k) ?? ''])));
  if (!parsed.success) return { success: false, error: 'Datos inválidos. La URL debe ser HTTPS y la referencia de secreto debe comenzar con vault://.' };
  try {
    const { accountId, name, loginUrl, usernameHint, secretRef, notes } = parsed.data;
    await prisma.accountPlatform.create({ data: {
      accountId, name, loginUrl: loginUrl || null, usernameHint: usernameHint || null,
      secretRef: secretRef || null, notes: notes || null,
    } });
    revalidatePath('/admin/platforms');
    return { success: true };
  } catch (error) {
    console.error('[PLATFORMS] Create failed', error);
    return { success: false, error: 'No se pudo registrar la plataforma. Comprueba la cuenta y el nombre.' };
  }
}
