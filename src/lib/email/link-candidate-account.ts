import type { Prisma } from '@prisma/client';
import { isProtectedAdminEmail } from '@/lib/admin-identity';
import type { ApplicationRef } from '@/lib/recruitment/application-ref';

type VerifiedSession = { id: string; email?: string; email_confirmed_at?: string; is_anonymous?: boolean; banned_until?: string };
type BindingClient = Pick<Prisma.TransactionClient, '$executeRaw' | '$queryRaw'>;
export type BindingResult = 'linked' | 'already_linked' | 'not_eligible' | 'conflict' | 'unavailable';
const normalize = (email: string) => email.trim().toLowerCase();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Internal only: ref must come from verifyApplicationRef and user from a
 * fresh server-side Supabase getUser(), never a form or client claim.
 * A signed application reference alone is not an authentication credential.
 */
export async function linkCandidateAccount(db: BindingClient, ref: ApplicationRef | null, user: VerifiedSession | null, now = new Date()): Promise<BindingResult> {
  if (!ref || !user || !uuid.test(user.id) || !user.email || user.is_anonymous || isProtectedAdminEmail(user.email)
    || !Number.isSafeInteger(ref.candidateId) || ref.candidateId < 1 || !ref.applicationId
    || !Number.isFinite(ref.expiresAt) || ref.expiresAt <= now.getTime()) return 'not_eligible';
  const confirmed = Date.parse(user.email_confirmed_at ?? '');
  const bannedUntil = user.banned_until ? Date.parse(user.banned_until) : null;
  if (!Number.isFinite(confirmed) || confirmed > now.getTime() || (bannedUntil !== null && (!Number.isFinite(bannedUntil) || bannedUntil > now.getTime()))) return 'not_eligible';
  const email = normalize(user.email);
  if (!email) return 'not_eligible';
  try {
    // Bind only the exact persisted candidate/application/profile tuple. The
    // unique constraints prevent both account reuse and candidate replacement.
    const inserted = await db.$executeRaw`
      INSERT INTO private_email.candidate_account_binding (candidate_id, account_id)
      SELECT c.id, p.id FROM public.recruitment_candidates c
      JOIN public.recruitment_applications a ON a.candidate_id = c.id
      JOIN public.user_profiles p ON p.id = ${user.id}::uuid
      WHERE c.id = ${ref.candidateId} AND a.id = ${ref.applicationId}
        AND lower(trim(c.email)) = ${email} AND lower(trim(p.email)) = ${email}
        AND p.role = 'candidate' AND p.interpreter_id IS NULL
        AND a.status::text NOT IN ('HIRED','HIRING','REJECTED','WITHDRAWN','EXPIRED')
      ON CONFLICT DO NOTHING
    `;
    if (inserted === 1) return 'linked';
    const rows = await db.$queryRaw<Array<{ matched: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM private_email.candidate_account_binding b
        JOIN public.recruitment_candidates c ON c.id = b.candidate_id
        JOIN public.recruitment_applications a ON a.candidate_id = c.id
        JOIN public.user_profiles p ON p.id = b.account_id
        WHERE b.candidate_id = ${ref.candidateId} AND b.account_id = ${user.id}::uuid
          AND b.revoked_at IS NULL AND a.id = ${ref.applicationId}
          AND lower(trim(c.email)) = ${email} AND lower(trim(p.email)) = ${email}
          AND p.role = 'candidate' AND p.interpreter_id IS NULL
          AND a.status::text NOT IN ('HIRED','HIRING','REJECTED','WITHDRAWN','EXPIRED')
      ) AS matched
    `;
    return rows[0]?.matched === true ? 'already_linked' : 'conflict';
  } catch {
    return 'unavailable';
  }
}
