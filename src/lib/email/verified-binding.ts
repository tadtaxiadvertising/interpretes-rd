import type { Prisma } from '@prisma/client';
import type { DispatchSnapshot } from './dispatch-eligibility';
import { isProtectedAdminEmail } from '@/lib/admin-identity';

type BindingRow = { candidateId: number; accountId: string; profileEmail: string; role: string | null; interpreterId: number | null };
type AuthIdentity = { id: string; email?: string; email_confirmed_at?: string; banned_until?: string; is_anonymous?: boolean };
type IdentityLookup = (id: string) => Promise<AuthIdentity | null>;
type Reader = Pick<Prisma.TransactionClient, 'recruitmentEvent' | '$queryRaw'>;
const normalize = (value: string | undefined) => value?.trim().toLowerCase() ?? '';

/** Reads one committed event and its explicitly recorded account UUID.
 * Missing or revoked bindings fail closed. No lookup by email, mutation or
 * credentials are exposed. Use a fresh authoritative Auth admin lookup by UUID.
 */
export async function loadDispatchSnapshot(db: Reader, eventId: string, getAuthIdentity: IdentityLookup, now = new Date()): Promise<DispatchSnapshot | null> {
  const event = await db.recruitmentEvent.findUnique({
    where: { id: eventId },
    select: { id: true, applicationId: true, eventType: true, toStatus: true, createdAt: true,
      application: { select: { id: true, status: true, candidateId: true, candidate: { select: { email: true } } } } },
  });
  if (!event) return null;
  const application = { id: event.application.id, status: event.application.status,
    candidateId: event.application.candidateId, email: event.application.candidate.email };
  const snapshot: DispatchSnapshot = { event: { id: event.id, applicationId: event.applicationId,
    eventType: event.eventType, toStatus: event.toStatus, createdAt: event.createdAt }, application, identity: null };
  const bindings = await db.$queryRaw<BindingRow[]>`
    SELECT b.candidate_id AS "candidateId", b.account_id::text AS "accountId",
      p.email AS "profileEmail", p.role, p.interpreter_id AS "interpreterId"
    FROM private_email.candidate_account_binding b
    JOIN public.user_profiles p ON p.id = b.account_id
    WHERE b.candidate_id = ${application.candidateId} AND b.revoked_at IS NULL
    LIMIT 2
  `;
  if (bindings.length !== 1) return snapshot;
  const b = bindings[0];
  if (b.candidateId !== application.candidateId || b.role !== 'candidate' || b.interpreterId !== null
    || isProtectedAdminEmail(b.profileEmail) || !normalize(b.profileEmail)
    || normalize(b.profileEmail) !== normalize(application.email)) return snapshot;
  const user = await getAuthIdentity(b.accountId);
  if (!user || user.id !== b.accountId || user.is_anonymous || !user.email || isProtectedAdminEmail(user.email)
    || normalize(user.email) !== normalize(b.profileEmail)) return snapshot;
  const verifiedAt = user.email_confirmed_at ? Date.parse(user.email_confirmed_at) : NaN;
  const bannedUntil = user.banned_until ? Date.parse(user.banned_until) : null;
  if (!Number.isFinite(verifiedAt) || verifiedAt > now.getTime()
    || (bannedUntil !== null && (!Number.isFinite(bannedUntil) || bannedUntil > now.getTime()))) return snapshot;
  return { ...snapshot, identity: { candidateId: b.candidateId, accountId: user.id, email: user.email, verified: true, active: true } };
}
