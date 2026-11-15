import { actorFromBearer } from '@/lib/api-auth';
import type { ResolvedIdentity } from '@/lib/identity/resolve-user';

type CookieIdentity = Pick<ResolvedIdentity, 'userId' | 'role' | 'candidateId' | 'interpreterId'>;

export type RoleplayCredentialDecision = 'ok' | 'unauthorized' | 'forbidden';

/**
 * Invitation endpoints write state using the authenticated browser cookie.
 * An explicit Authorization header is never allowed to authorize a different
 * actor or silently fall back to the cookie after Bearer verification fails.
 */
export async function verifyRoleplayCookieBearer(
  request: Request,
  identity: CookieIdentity,
): Promise<RoleplayCredentialDecision> {
  if (!request.headers.has('authorization')) return 'ok';

  const bearer = await actorFromBearer(request);
  if (!bearer) return 'unauthorized';

  if (
    bearer.userId !== identity.userId ||
    bearer.role !== identity.role ||
    (identity.role === 'candidate' && bearer.candidateId !== identity.candidateId) ||
    (identity.role === 'interpreter' && bearer.interpreterId !== identity.interpreterId)
  ) {
    return 'forbidden';
  }

  return 'ok';
}
