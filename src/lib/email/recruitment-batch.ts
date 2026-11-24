import type { Prisma } from '@prisma/client';
import type { DispatchResult } from './recruitment-dispatch';

export const MAX_EMAIL_BATCH = 2;
const EVENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export type EmailBatchResult = {
  status: 'completed' | 'disabled' | 'busy' | 'unavailable';
  selected: number;
  accepted: number;
  unconfirmed: number;
  cancelled: number;
  deferred: number;
  reconciliationRequired: number;
};
export function emptyEmailBatch(status: EmailBatchResult['status']): EmailBatchResult {
  return { status, selected: 0, accepted: 0, unconfirmed: 0, cancelled: 0, deferred: 0, reconciliationRequired: 0 };
}

type BatchReader = Pick<Prisma.TransactionClient, '$queryRaw'>;

/** Find only recent, currently relevant events with active private bindings.
 * Does not expose addresses; the dispatcher independently rechecks identity.
 * Select newest matching event per application, then oldest first across applications.
 */
export async function selectRecentEmailEvents(db: BatchReader, cutover: Date, now: Date): Promise<string[]> {
  const earliest = new Date(Math.max(cutover.getTime(), now.getTime() - EVENT_WINDOW_MS));
  if (!Number.isFinite(earliest.getTime()) || earliest > now) return [];
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT eligible.id FROM (
      SELECT DISTINCT ON (a.id) e.id, e.created_at
      FROM public.recruitment_events e
      JOIN public.recruitment_applications a ON a.id = e.application_id
      JOIN private_email.candidate_account_binding b ON b.candidate_id = a.candidate_id AND b.revoked_at IS NULL
      JOIN public.user_profiles p ON p.id = b.account_id
      WHERE e.created_at >= ${earliest} AND e.created_at <= ${now}
        AND a.status = e.to_status AND p.role = 'candidate' AND p.interpreter_id IS NULL
        AND ((e.event_type::text = 'APPLICATION_CREATED' AND e.to_status::text = 'APPLIED')
          OR (e.event_type::text = 'INDUCTION_COMPLETED' AND e.to_status::text = 'ROLEPLAY_PENDING')
          OR (e.event_type::text = 'ROLEPLAY_PASSED' AND e.to_status::text = 'INTERVIEW_PENDING'))
      ORDER BY a.id, e.created_at DESC, e.id DESC
    ) eligible
    LEFT JOIN private_email.recruitment_delivery d ON d.event_id = eligible.id
    WHERE d.event_id IS NULL OR d.status = 'pending'
    ORDER BY eligible.created_at, eligible.id LIMIT 2
  `;
  return rows.map(row => row.id);
}

type BatchDependencies = {
  select: () => Promise<string[]>;
  enqueue: (id: string) => Promise<'queued' | 'duplicate' | 'ineligible'>;
  process: (id: string) => Promise<DispatchResult>;
};

/** Sequential and bounded even if a repository adapter returns too many IDs.
 * Stop on uncertainty rather than starting additional SMTP requests.
 */
export async function runEmailBatch(deps: BatchDependencies): Promise<EmailBatchResult> {
  const result = emptyEmailBatch('completed');
  try {
    const ids = [...new Set(await deps.select())].slice(0, MAX_EMAIL_BATCH);
    result.selected = ids.length;
    for (const id of ids) {
      if (await deps.enqueue(id) === 'ineligible') { result.deferred++; continue; }
      const outcome = await deps.process(id);
      if (outcome === 'accepted') result.accepted++;
      else if (outcome === 'unconfirmed') { result.unconfirmed++; break; }
      else if (outcome === 'reconciliation_required') { result.reconciliationRequired++; break; }
      else if (outcome === 'cancelled') result.cancelled++;
      else if (outcome === 'disabled') { result.status = 'disabled'; break; }
      else result.deferred++;
    }
  } catch {
    result.status = 'unavailable';
  }
  return result;
}
