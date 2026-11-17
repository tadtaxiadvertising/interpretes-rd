'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';
import prisma from '@/lib/prisma';
import { ActionResult } from '@/lib/types';
import { validateAction } from '@/lib/auth/actions';

const db = prisma;

/**
 * ACTION: Update a system configuration key
 */
export async function updateSystemConfig(key: string, value: string): Promise<ActionResult> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  // Secrets must only be changed through the encrypted Audio Studio settings action.
  if (!key || typeof key !== 'string' || key.length > 100 || key.startsWith('audio_studio_')) {
    return { success: false, error: 'Invalid config key', code: 'VALIDATION_ERROR' };
  }

  try {
    await db.systemConfig.upsert({
      where: { key },
      update: { value },
      create: { key, value },
      select: { key: true }
    });

    // These paths render values supplied by an unstable_cache-tagged reader.
    // Path invalidation alone does not immediately invalidate that data cache.
    revalidateTag('system-config');
    revalidatePath('/admin');
    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    console.error('Error updating system config:', safeServerErrorCategory(error));
    return { success: false, error: 'Failed to update configuration', code: 'INTERNAL_ERROR' };
  }
}

