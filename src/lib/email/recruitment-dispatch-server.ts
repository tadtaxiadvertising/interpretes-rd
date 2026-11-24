import prisma from '@/lib/prisma';
import { pilotRecipient } from './pilot-recipient';
import { readOperationalMailConfig } from './operational-config';
import { dispatchRecruitmentEmail, type DispatchResult } from './recruitment-dispatch';
import { claimRecruitmentEmail, finishRecruitmentEmail } from './recruitment-delivery-ledger';
import { loadVerifiedRecruitmentDispatch } from './verified-binding-server';
import { sendRecruitmentSmtp } from './smtp-test';

/** Internal adapter for one previously queued event. Not exposed as a server
 * action, route, worker or cron. No historical event discovery or auto-retry.
 */
export async function processQueuedRecruitmentEmail(eventId: string): Promise<DispatchResult> {
  if (process.env.OPERATIONAL_EMAIL_DISPATCH_ENABLED !== 'true'
    || process.env.OPERATIONAL_EMAIL_BINDING_ENABLED !== 'true'
    || readOperationalMailConfig(process.env).status !== 'configured') return 'disabled';

  const pilot = pilotRecipient(process.env);
  if (pilot === false) return 'disabled';

  // Require an explicit deployment cutover to avoid sending older events.
  const cutover = process.env.OPERATIONAL_EMAIL_DISPATCH_NOT_BEFORE;
  const cutoverTime = cutover && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(cutover) ? Date.parse(cutover) : NaN;
  if (!Number.isFinite(cutoverTime) || cutoverTime > Date.now()) return 'disabled';

  return dispatchRecruitmentEmail(eventId, true, {
    load: async (id) => {
      const snapshot = await loadVerifiedRecruitmentDispatch(id);
      return snapshot && snapshot.event.createdAt.getTime() >= cutoverTime
        && (!pilot || snapshot.identity?.email.trim().toLowerCase() === pilot) ? snapshot : null;
    },
    claim: (id) => claimRecruitmentEmail(prisma, id),
    finish: (id, status) => finishRecruitmentEmail(prisma, id, status),
    send: sendRecruitmentSmtp,
    now: () => new Date(),
  });
}
