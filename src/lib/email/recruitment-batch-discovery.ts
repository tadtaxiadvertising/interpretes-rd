import type { Prisma } from '@prisma/client';
import { emailKindForEvent } from './recruitment-event-policy';
import type { RecruitmentApplicationStatus, RecruitmentEventType } from '@/lib/prisma-types';

type EventRow = { id: string; applicationId: string; eventType: RecruitmentEventType; toStatus: RecruitmentApplicationStatus };
export const EMAIL_BATCH_LIMIT = 3;

/** Bounded discovery, separate from recruitment transactions. No historical backfill. */
export async function discoverEmailEvents(db: Pick<Prisma.TransactionClient, '$queryRaw'>, cutover: Date, now: Date, pilot: string | null = null): Promise<string[]> {
  if (!Number.isFinite(cutover.getTime()) || !Number.isFinite(now.getTime()) || cutover > now) return [];
  const earliest = new Date(Math.max(cutover.getTime(), now.getTime() - 86400000));
  const rows = await db.$queryRaw<EventRow[]>`
    SELECT e.id, e.application_id AS "applicationId", e.event_type::text AS "eventType", e.to_status::text AS "toStatus"
    FROM public.recruitment_events e
    JOIN public.recruitment_applications a ON a.id = e.application_id
    JOIN public.recruitment_candidates c ON c.id = a.candidate_id
    JOIN private_email.candidate_account_binding b ON b.candidate_id = a.candidate_id AND b.revoked_at IS NULL
    JOIN public.user_profiles p ON p.id = b.account_id AND p.role = 'candidate' AND p.interpreter_id IS NULL
    LEFT JOIN private_email.recruitment_delivery d ON d.event_id = e.id
    WHERE e.created_at >= ${earliest} AND e.created_at <= ${now}
      AND lower(trim(c.email)) = lower(trim(p.email))
      AND b.verified_email = lower(trim(c.email)) AND b.mailbox_verified_at IS NOT NULL AND b.mailbox_verified_at <= ${now}
      AND (${pilot}::text IS NULL OR lower(trim(c.email)) = ${pilot})
      AND a.status = e.to_status AND (d.event_id IS NULL OR d.status = 'pending')
      AND ((e.event_type::text = 'APPLICATION_CREATED' AND e.to_status::text = 'APPLIED')
        OR (e.event_type::text = 'INDUCTION_COMPLETED' AND e.to_status::text = 'ROLEPLAY_PENDING')
        OR (e.event_type::text = 'ROLEPLAY_PASSED' AND e.to_status::text = 'INTERVIEW_PENDING'))
    ORDER BY e.created_at DESC, e.id DESC LIMIT 3
  `;
  return rows.filter(row => emailKindForEvent(row) !== null).map(row => row.id).slice(0, EMAIL_BATCH_LIMIT);
}
