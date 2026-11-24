'use server';

import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { readEmailHistory } from '@/lib/email/delivery-history';
import type { EmailHistoryReport } from '@/lib/email/history-types';

export async function getCorporateEmailHistory(): Promise<EmailHistoryReport> {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return { status: 'unauthorized' };
    return await readEmailHistory(prisma);
  } catch {
    return { status: 'unavailable' };
  }
}
