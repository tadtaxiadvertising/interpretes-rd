'use server';
import { validateAction } from '@/lib/auth/actions';
import { emailDeliveryMode } from '@/lib/email/pilot-recipient';
import { processRecruitmentEmailBatch } from '@/lib/email/recruitment-batch-server';
import { emptyBatch, type BatchReport } from '@/lib/email/recruitment-batch';

export async function runCorporateEmailPilot(): Promise<BatchReport | { status: 'unauthorized' }> {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return { status: 'unauthorized' };
    if (emailDeliveryMode(process.env) !== 'pilot' || process.env.OPERATIONAL_EMAIL_SCHEDULER_ENABLED === 'true') return emptyBatch('disabled');
    return await processRecruitmentEmailBatch();
  } catch {
    return emptyBatch('unavailable');
  }
}
