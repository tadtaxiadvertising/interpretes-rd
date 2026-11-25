'use server';
import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { inspectProviderVault, type VaultReadiness } from '@/lib/email/provider-readiness';

export async function checkProviderVaultReadiness(): Promise<VaultReadiness | { database: 'unauthorized' | 'unavailable' }> {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return { database: 'unauthorized' };
    return await inspectProviderVault(prisma, process.env);
  } catch { return { database: 'unavailable' }; }
}
