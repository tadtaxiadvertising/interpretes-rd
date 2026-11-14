'use server';

import { revalidatePath, unstable_cache } from 'next/cache';
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

  if (!key || typeof key !== 'string' || key.length > 100) {
    return { success: false, error: 'Invalid config key', code: 'VALIDATION_ERROR' };
  }

  try {
    await db.systemConfig.upsert({
      where: { key },
      update: { value },
      create: { key, value },
      select: { key: true }
    });

    revalidatePath('/admin');
    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    console.error('Error updating system config:', safeServerErrorCategory(error));
    return { success: false, error: 'Failed to update configuration', code: 'INTERNAL_ERROR' };
  }
}

/**
 * CACHED FETCH: Get system config value
 * Optimized with unstable_cache for high-performance reads.
 */
const getSystemConfigCached = unstable_cache(
  async (key: string, defaultValue: string = '') => {
    try {
      const config = await db.systemConfig.findUnique({
        where: { key },
        select: { value: true }
      });
      return config ? config.value : defaultValue;
    } catch (error) {
      console.error('Error fetching system config:', safeServerErrorCategory(error));
      return defaultValue;
    }
  },
  ['system-config'],
  { tags: ['system-config'], revalidate: 3600 }
);

/**
 * Legacy wrapper for compatibility
 */
export async function getSystemConfig(key: string, defaultValue: string = ''): Promise<string> {
  return getSystemConfigCached(key, defaultValue);
}
