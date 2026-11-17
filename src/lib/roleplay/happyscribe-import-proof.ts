import { createHmac, timingSafeEqual } from 'node:crypto';

// Proves an ID came from an authenticated, organization-filtered HappyScribe
// listing for this admin. No provider transcript or secret is stored here.
const PROOF_TTL_MS = 45 * 60 * 1000;
type Scope = { id: string; organizationId: string; userId: string; token: string };

function digest(scope: Scope, expiresAt: number) {
  // Length-delimited values prevent ambiguity between concatenated fields.
  const payload = JSON.stringify([1, scope.id, scope.organizationId, scope.userId, expiresAt]);
  return createHmac('sha256', scope.token).update(payload, 'utf8').digest('hex');
}

export function issueHappyScribeImportProof(scope: Scope, now = Date.now()): string {
  const expiresAt = now + PROOF_TTL_MS;
  return `${expiresAt}.${digest(scope, expiresAt)}`;
}

export function verifyHappyScribeImportProof(
  scope: Scope, proof: unknown, now = Date.now(),
): boolean {
  if (typeof proof !== 'string' || !/^\d{13}\.[a-f0-9]{64}$/.test(proof)) return false;
  const [expiry, mac] = proof.split('.');
  const expiresAt = Number(expiry);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now ||
      expiresAt > now + PROOF_TTL_MS) return false;
  const expected = Buffer.from(digest(scope, expiresAt), 'hex');
  const provided = Buffer.from(mac, 'hex');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
