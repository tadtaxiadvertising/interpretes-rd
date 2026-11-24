import type { Prisma } from '@prisma/client';
import { emailKindForEvent } from './recruitment-event-policy';
import type { RecruitmentEmailKind } from './recruitment-templates';

/** Server-side persistence primitives. Not connected to a dispatcher.
 * Requires the separately approved private_email schema. No SMTP calls here.
 */
type LedgerClient = Pick<Prisma.TransactionClient, 'recruitmentEvent' | '$executeRaw' | '$queryRaw'>;

export async function enqueueRecruitmentEmail(db: LedgerClient, eventId: string): Promise<'queued' | 'duplicate' | 'ineligible'> {
  const event = await db.recruitmentEvent.findUnique({
    where: { id: eventId },
    select: { id: true, applicationId: true, eventType: true, toStatus: true },
  });
  if (!event) return 'ineligible';
  const kind = emailKindForEvent(event);
  if (!kind) return 'ineligible';
  const inserted = await db.$executeRaw`
    INSERT INTO private_email.recruitment_delivery (event_id, template_kind)
    VALUES (${event.id}, ${kind}) ON CONFLICT (event_id) DO NOTHING
  `;
  return inserted === 1 ? 'queued' : 'duplicate';
}

export async function claimRecruitmentEmail(db: LedgerClient, eventId: string): Promise<{ eventId: string; kind: RecruitmentEmailKind } | null> {
  const rows = await db.$queryRaw<Array<{ eventId: string; kind: RecruitmentEmailKind }>>`
    UPDATE private_email.recruitment_delivery
    SET status = 'sending', claimed_at = now()
    WHERE event_id = ${eventId} AND status = 'pending'
    RETURNING event_id AS "eventId", template_kind AS "kind"
  `;
  return rows[0] ?? null;
}

/** Never auto-retry an ambiguous SMTP result or a crashed sending attempt. */
export async function finishRecruitmentEmail(db: LedgerClient, eventId: string, result: 'accepted' | 'unconfirmed' | 'cancelled'): Promise<boolean> {
  if (result !== 'accepted' && result !== 'unconfirmed' && result !== 'cancelled') return false;
  const changed = await db.$executeRaw`
    UPDATE private_email.recruitment_delivery
    SET status = ${result}, completed_at = now()
    WHERE event_id = ${eventId} AND status = 'sending'
  `;
  return changed === 1;
}
