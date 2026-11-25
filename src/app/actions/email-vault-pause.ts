'use server';

import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { readVaultPause, setVaultPause, canUnpauseVault, type VaultPauseState } from '@/lib/email/vault-pause';

export async function getEmailVaultPause(): Promise<{ state: VaultPauseState | 'unauthorized'; canResume: boolean }> {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return { state: 'unauthorized', canResume: false };
    return { state: await readVaultPause(prisma), canResume: canUnpauseVault(process.env) };
  } catch { return { state: 'unavailable', canResume: false }; }
}

export async function changeEmailVaultPause(paused: boolean): Promise<'paused' | 'unpaused' | 'blocked' | 'unavailable' | 'unauthorized'> {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return 'unauthorized';
    if (typeof paused !== 'boolean' || (!paused && !canUnpauseVault(process.env))) return 'blocked';
    return await setVaultPause(prisma, paused, auth.user.userId) ? paused ? 'paused' : 'unpaused' : 'blocked';
  } catch { return 'unavailable'; }
}
