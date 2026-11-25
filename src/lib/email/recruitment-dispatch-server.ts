import prisma from '@/lib/prisma';
import { emailDeliveryMode, pilotRecipient } from './pilot-recipient';
import { readOperationalMailConfig } from './operational-config';
import { dispatchRecruitmentEmail, type DispatchResult } from './recruitment-dispatch';
import { claimRecruitmentEmail, finishRecruitmentEmail } from './recruitment-delivery-ledger';
import { loadVerifiedRecruitmentDispatch } from './verified-binding-server';
import { sendRecruitmentSmtp } from './smtp-test';
import { usesProviderVault, readPreferredProvider, reserveSelectedProvider, sendReservedProfile } from './preferred-provider-runtime';

/** Internal adapter for one previously queued event. Not exposed as a server
 * action, route, worker or cron. No historical event discovery or auto-retry.
 */
export async function processQueuedRecruitmentEmail(eventId: string): Promise<DispatchResult> {
  if (process.env.OPERATIONAL_EMAIL_DISPATCH_ENABLED !== 'true'
    || process.env.OPERATIONAL_EMAIL_BINDING_ENABLED !== 'true'
    ) return 'disabled';

  const pilot = pilotRecipient(process.env);
  if (pilot === false || emailDeliveryMode(process.env) === 'disabled') return 'disabled';

  // Require an explicit deployment cutover to avoid sending older events.
  const cutover = process.env.OPERATIONAL_EMAIL_DISPATCH_NOT_BEFORE;
  const cutoverTime = cutover && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(cutover) ? Date.parse(cutover) : NaN;
  if (!Number.isFinite(cutoverTime) || cutoverTime > Date.now()) return 'disabled';

  const vault = usesProviderVault(process.env);
  if (vault && emailDeliveryMode(process.env) !== 'pilot') return 'disabled';
  const selected = vault ? await readPreferredProvider(prisma, process.env) : null;
  if (vault ? !selected : readOperationalMailConfig(process.env).status !== 'configured') return 'disabled';
  const quotaBlocked = new Error('Provider budget unavailable');
  let blocked = false;
  const result = await dispatchRecruitmentEmail(eventId, true, {
    load: async (id) => {
      const snapshot = await loadVerifiedRecruitmentDispatch(id);
      return snapshot && snapshot.event.createdAt.getTime() >= cutoverTime
        && (!pilot || snapshot.identity?.email.trim().toLowerCase() === pilot) ? snapshot : null;
    },
    claim: async (id) => {
      if (!selected) return claimRecruitmentEmail(prisma, id);
      try {
        return await prisma.$transaction(async tx => {
          const claim = await claimRecruitmentEmail(tx, id);
          if (!claim) return null;
          if (!await reserveSelectedProvider(tx, selected)) throw quotaBlocked;
          return claim;
        });
      } catch (error) {
        if (error !== quotaBlocked) throw error;
        blocked = true;
        return null;
      }
    },
    finish: (id, status) => finishRecruitmentEmail(prisma, id, status),
    send: selected ? message => sendReservedProfile(selected, message) : sendRecruitmentSmtp,
    now: () => new Date(),
  });
  return blocked && result === 'not_claimed' ? 'disabled' : result;
}
