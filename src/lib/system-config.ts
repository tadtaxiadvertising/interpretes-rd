/**
 * Internal server-only SystemConfig reader for trusted Server Components and
 * services. Unlike the old implementation under 'use server', this module
 * does NOT register a remotely invocable Server Action that can fetch arbitrary
 * system configuration keys without authorizing the caller.
 *
 * Do not import this module from a client component or expose it through an
 * unguarded API. For user changes, use the protected updateSystemConfig action.
 */
import { unstable_cache } from 'next/cache';
import prisma from '@/lib/prisma';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

const db = prisma;

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

/** Read a configuration value from trusted server code only. */
export async function getSystemConfig(key: string, defaultValue: string = ''): Promise<string> {
  return getSystemConfigCached(key, defaultValue);
}

