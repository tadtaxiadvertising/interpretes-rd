import type { Prisma } from '@prisma/client';
import { emailRolloutReadiness } from './automation-status';
import { pilotRecipient } from './pilot-recipient';
import { readEmailDatabaseReadiness } from './database-readiness';
import { discoverEmailEvents } from './recruitment-batch-discovery';
import { evaluateDispatch, type DispatchSnapshot } from './dispatch-eligibility';

export type PilotPreflightStatus = 'disabled' | 'configuration_pending' | 'database_pending'
  | 'candidate_missing' | 'binding_missing' | 'mailbox_pending' | 'mailbox_unverified'
  | 'review_required' | 'no_event' | 'identity_unverified' | 'ready' | 'unavailable';
export type PilotPreflightReport = { status: PilotPreflightStatus };
type Reader = Pick<Prisma.TransactionClient, '$queryRaw'>;
type Row = { linked: boolean; verified: boolean; pending: boolean; uncertain: boolean };

/** No writes, SMTP calls or candidate identifiers in the returned report.
 * The caller must authorize administrative access before invoking this helper. */
export async function inspectEmailPilot(
  db: Reader,
  env: Readonly<Record<string, string | undefined>>,
  load: (eventId: string) => Promise<DispatchSnapshot | null>,
  now = new Date(),
): Promise<PilotPreflightReport> {
  try {
    const readiness = emailRolloutReadiness(env, now);
    const pilot = pilotRecipient(env);
    if (readiness.mode !== 'pilot' || !pilot) return { status: 'disabled' };
    if (!readiness.ready) return { status: 'configuration_pending' };
    if ((await readEmailDatabaseReadiness(db)).status !== 'ready') return { status: 'database_pending' };

    // Only the configured test mailbox; no caller-provided recipient.
    const rows = await db.$queryRaw<Row[]>`
      SELECT
        COALESCE(b.account_id IS NOT NULL AND p.id IS NOT NULL AND p.role = 'candidate'
          AND p.interpreter_id IS NULL AND lower(trim(p.email)) = ${pilot}, false) AS linked,
        COALESCE(b.verified_email = ${pilot} AND b.mailbox_verified_at <= ${now}, false) AS verified,
        COALESCE(b.challenge_email = ${pilot} AND b.challenge_hash IS NOT NULL
          AND b.challenge_expires_at > ${now}, false) AS pending,
        EXISTS (SELECT 1 FROM public.recruitment_applications a
          JOIN public.recruitment_events e ON e.application_id = a.id
          JOIN private_email.recruitment_delivery d ON d.event_id = e.id
          WHERE a.candidate_id = c.id AND d.status IN ('sending','unconfirmed')) AS uncertain
      FROM public.recruitment_candidates c
      LEFT JOIN private_email.candidate_account_binding b ON b.candidate_id = c.id AND b.revoked_at IS NULL
      LEFT JOIN public.user_profiles p ON p.id = b.account_id
      WHERE lower(trim(c.email)) = ${pilot}
      LIMIT 2
    `;
    if (!rows.length) return { status: 'candidate_missing' };
    if (rows.length !== 1) return { status: 'review_required' };
    const row = rows[0];
    if (row.uncertain) return { status: 'review_required' };
    if (!row.linked) return { status: 'binding_missing' };
    if (!row.verified) return { status: row.pending ? 'mailbox_pending' : 'mailbox_unverified' };

    const cutover = new Date(env.OPERATIONAL_EMAIL_DISPATCH_NOT_BEFORE ?? '');
    const [eventId] = await discoverEmailEvents(db, cutover, now, pilot);
    if (!eventId) return { status: 'no_event' };
    const snapshot = await load(eventId);
    if (!snapshot || snapshot.event.id !== eventId || snapshot.event.createdAt < cutover) return { status: 'identity_unverified' };
    const eligibility = evaluateDispatch(snapshot, now);
    return { status: eligibility.status === 'eligible' && eligibility.recipient === pilot ? 'ready' : 'identity_unverified' };
  } catch {
    return { status: 'unavailable' };
  }
}
