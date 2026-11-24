import prisma from '@/lib/prisma';
import { recruitmentDispatchCutover } from './dispatch-config';
import { dispatchRecruitmentEmail, type DispatchResult } from './recruitment-dispatch';
import { claimRecruitmentEmail, finishRecruitmentEmail } from './recruitment-delivery-ledger';
import { loadVerifiedRecruitmentDispatch } from './verified-binding-server';
import { sendRecruitmentSmtp } from './smtp-test';

/** Internal adapter for one previously queued event. Not exposed as a server
 * action, route, worker or cron. No historical event discovery or auto-retry.
 */
export async function processQueuedRecruitmentEmail(eventId: string): Promise<DispatchResult> {
  const cutover = recruitmentDispatchCutover(process.env, new Date());
  if (!cutover) return 'disabled';
  const cutoverTime = cutover.getTime();

  return dispatchRecruitmentEmail(eventId, true, {
    load: async (id) => {
      const snapshot = await loadVerifiedRecruitmentDispatch(id);
      return snapshot && snapshot.event.createdAt.getTime() >= cutoverTime ? snapshot : null;
    },
    claim: (id) => claimRecruitmentEmail(prisma, id),
    finish: (id, status) => finishRecruitmentEmail(prisma, id, status),
    send: sendRecruitmentSmtp,
    now: () => new Date(),
  });
}
