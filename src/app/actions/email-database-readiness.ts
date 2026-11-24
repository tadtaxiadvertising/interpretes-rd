'use server';

import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { readEmailDatabaseReadiness, type EmailDatabaseReadiness } from '@/lib/email/database-readiness';

export async function checkCorporateEmailDatabase(): Promise<EmailDatabaseReadiness | { status: 'unauthorized' }> {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return { status: 'unauthorized' };
    return await readEmailDatabaseReadiness(prisma);
  } catch {
    return { status: 'unavailable' };
  }
}
