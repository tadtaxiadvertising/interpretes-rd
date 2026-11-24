import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';

type Client = Pick<Prisma.TransactionClient, '$executeRaw' | '$queryRaw'>;
type Binding = { candidateId: number; accountId: string; email: string };
export type MailboxChallengeResult = 'sent' | 'unconfirmed' | 'not_available' | 'already_verified' | 'code_pending';
export type MailboxProofResult = 'verified' | 'invalid' | 'unavailable';

export type MailboxState = 'verified' | 'pending' | 'unverified' | 'unavailable';

/** Read only a binding belonging to the authenticated account UUID. Never
 * return identifiers, challenge hashes, addresses or other account details.
 * The optional candidate ID narrows the challenge-issuance fallback. */
export async function readMailboxState(db: Pick<Client, '$queryRaw'>, accountId: string, email: string, candidateId: number | null = null): Promise<MailboxState> {
  const [row] = await db.$queryRaw<Array<{ verified: boolean; pending: boolean }>>`
    SELECT COALESCE(b.verified_email = ${email} AND b.mailbox_verified_at <= now(), false) AS verified,
      COALESCE(b.challenge_email = ${email} AND b.challenge_hash IS NOT NULL AND b.challenge_expires_at > now(), false) AS pending
    FROM private_email.candidate_account_binding b
    JOIN public.recruitment_candidates c ON c.id = b.candidate_id
    JOIN public.user_profiles p ON p.id = b.account_id
    WHERE b.account_id = ${accountId}::uuid AND (${candidateId}::integer IS NULL OR b.candidate_id = ${candidateId})
      AND b.revoked_at IS NULL AND p.role = 'candidate' AND p.interpreter_id IS NULL
      AND lower(trim(c.email)) = ${email} AND lower(trim(p.email)) = ${email}
    LIMIT 1
  `;
  return row?.verified ? 'verified' : row?.pending ? 'pending' : 'unverified';
}

const digest = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

/** Caller must establish authenticated session and matching signed reference first.
 * A persisted cooldown prevents concurrent repeated sends for the same binding.
 */
export async function issueMailboxChallenge(db: Client, binding: Binding, send: (email: string, token: string) => Promise<'accepted' | 'unconfirmed'>): Promise<MailboxChallengeResult> {
  const token = randomBytes(16).toString('hex');
  try {
    const changed = await db.$executeRaw`
      UPDATE private_email.candidate_account_binding b
      SET challenge_email = ${binding.email}, challenge_hash = ${digest(token)},
        challenge_issued_at = now(), challenge_expires_at = now() + interval '15 minutes'
      FROM public.recruitment_candidates c, public.user_profiles p
      WHERE b.candidate_id = ${binding.candidateId} AND b.account_id = ${binding.accountId}::uuid
        AND b.revoked_at IS NULL AND c.id = b.candidate_id AND p.id = b.account_id
        AND p.role = 'candidate' AND p.interpreter_id IS NULL
        AND lower(trim(c.email)) = ${binding.email} AND lower(trim(p.email)) = ${binding.email}
        AND (b.challenge_issued_at IS NULL OR b.challenge_issued_at <= now() - interval '5 minutes')
        -- A code already sent for this mailbox remains usable for its entire
        -- advertised lifetime, even after the shorter abuse cooldown ends.
        AND (b.challenge_email IS DISTINCT FROM ${binding.email} OR b.challenge_hash IS NULL
          OR b.challenge_expires_at IS NULL OR b.challenge_expires_at <= now())
        AND (b.verified_email IS DISTINCT FROM ${binding.email} OR b.mailbox_verified_at IS NULL)
    `;
    if (changed !== 1) {
      const state = await readMailboxState(db, binding.accountId, binding.email, binding.candidateId);
      return state === 'verified' ? 'already_verified' : state === 'pending' ? 'code_pending' : 'not_available';
    }
    return await send(binding.email, token) === 'accepted' ? 'sent' : 'unconfirmed';
  } catch {
    return 'unconfirmed';
  }
}

/** Atomic consumption; expired, mismatched and previously used tokens cannot verify. */
export async function consumeMailboxChallenge(db: Client, binding: Binding, token: string): Promise<MailboxProofResult> {
  if (!/^[0-9a-f]{32}$/.test(token)) return 'invalid';
  try {
    const changed = await db.$executeRaw`
      UPDATE private_email.candidate_account_binding b
      SET verified_email = b.challenge_email, mailbox_verified_at = now(),
        challenge_email = NULL, challenge_hash = NULL, challenge_expires_at = NULL
      FROM public.recruitment_candidates c, public.user_profiles p
      WHERE b.candidate_id = ${binding.candidateId} AND b.account_id = ${binding.accountId}::uuid
        AND b.revoked_at IS NULL AND c.id = b.candidate_id AND p.id = b.account_id
        AND p.role = 'candidate' AND p.interpreter_id IS NULL
        AND lower(trim(c.email)) = ${binding.email} AND lower(trim(p.email)) = ${binding.email}
        AND b.challenge_email = ${binding.email} AND b.challenge_hash = ${digest(token)}
        AND b.challenge_expires_at > now()
    `;
    return changed === 1 ? 'verified' : 'invalid';
  } catch {
    return 'unavailable';
  }
}
