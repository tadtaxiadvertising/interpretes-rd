import prisma from '@/lib/prisma';
import { recruitmentDispatchCutover } from './dispatch-config';
import { emptyEmailBatch, runEmailBatch, selectRecentEmailEvents, type EmailBatchResult } from './recruitment-batch';
import { enqueueRecruitmentEmail } from './recruitment-delivery-ledger';
import { processQueuedRecruitmentEmail } from './recruitment-dispatch-server';

let busy = false;
let nextRunAt = 0;

/** Bounded on-demand processor; no timers, no persistent worker. The
 * cooldown is process-local; the database event claim is cross-process. */
export async function processRecentRecruitmentEmails(): Promise<EmailBatchResult> {
  const now = new Date();
  const cutover = recruitmentDispatchCutover(process.env, now);
  if (!cutover) return emptyEmailBatch('disabled');
  if (busy || now.getTime() < nextRunAt) return emptyEmailBatch('busy');
  busy = true;
  nextRunAt = now.getTime() + 60000;
  try {
    return await runEmailBatch({
      select: () => selectRecentEmailEvents(prisma, cutover, now),
      enqueue: id => enqueueRecruitmentEmail(prisma, id),
      process: processQueuedRecruitmentEmail,
    });
  } finally {
    busy = false;
  }
}
