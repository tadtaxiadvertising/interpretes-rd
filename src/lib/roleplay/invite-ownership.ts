import type { ResolvedIdentity } from '@/lib/identity/resolve-user';

type InviteIdentity = Pick<ResolvedIdentity, 'role' | 'candidateId' | 'interpreterId'>;
type InviteSession = { recruitmentCandidateId: number | null; interpreterId: number | null };

/**
 * Invitation possession is not identity. Candidate-owned sessions take
 * precedence over any provisional interpreterId retained in legacy rows.
 * This is the same ownership boundary used by session reads and uploads.
 */
export function canBindRoleplayInvitation(
  identity: InviteIdentity | null,
  session: InviteSession,
): boolean {
  if (!identity) return false;
  if (identity.role === 'admin') return true;
  if (session.recruitmentCandidateId !== null) {
    return identity.role === 'candidate'
      && identity.candidateId === session.recruitmentCandidateId;
  }
  return session.interpreterId !== null
    && identity.role === 'interpreter'
    && identity.interpreterId === session.interpreterId;
}
