'use server';

import { validateAction } from '@/lib/auth/actions';
import { processRecentRecruitmentEmails } from '@/lib/email/recruitment-batch-server';
import { emptyEmailBatch, type EmailBatchResult } from '@/lib/email/recruitment-batch';

export async function processCorporateEmailBatch(): Promise<EmailBatchResult | { status: 'unauthorized' }> {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return { status: 'unauthorized' };
    return await processRecentRecruitmentEmails();
  } catch {
    return emptyEmailBatch('unavailable');
  }
}
