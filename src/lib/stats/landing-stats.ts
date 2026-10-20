import { unstable_cache } from 'next/cache';
import prisma from '@/lib/prisma';

export interface LandingStats {
  /** Total interpreters registered on the platform. */
  interpreters: number;
  /** Distinct client accounts with recorded production in the last 5 years. */
  accountsWorked: number;
}

const FIVE_YEARS_MS = 5 * 365.25 * 24 * 60 * 60 * 1000;

/**
 * Computes the public, non-sensitive aggregate figures shown on the landing
 * page. These are derived exclusively from real persisted data — no values are
 * invented or hardcoded.
 */
async function queryLandingStats(): Promise<LandingStats> {
  const since = new Date(Date.now() - FIVE_YEARS_MS);

  const [interpreters, accounts] = await Promise.all([
    prisma.interpreter.count(),
    prisma.productionLog.findMany({
      where: { date: { gte: since }, accountId: { not: null } },
      distinct: ['accountId'],
      select: { accountId: true },
    }),
  ]);

  return { interpreters, accountsWorked: accounts.length };
}

const getCachedLandingStats = unstable_cache(queryLandingStats, ['landing-stats-v1'], {
  revalidate: 3600,
  tags: ['landing-stats'],
});

/**
 * Returns the landing page statistics, or `null` when the data cannot be read.
 * Callers MUST omit the section entirely when `null` is returned so that no
 * placeholder or fabricated number is ever shown to the public.
 */
export async function getLandingStats(): Promise<LandingStats | null> {
  try {
    return await getCachedLandingStats();
  } catch (error) {
    console.error('[landing-stats] failed to compute public stats:', error);
    return null;
  }
}
