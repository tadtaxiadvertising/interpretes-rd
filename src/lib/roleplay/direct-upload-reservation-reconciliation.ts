import type { PrismaClient } from '@prisma/client';
import { prepareNewRoleplayUploadReservation } from '@/lib/roleplay/direct-upload-reservation';
import {
  fingerprintRoleplayDirectUploadDeclarations,
  isRoleplayDirectUploadRequestKey,
} from '@/lib/roleplay/direct-upload-reservation-fingerprint';

export type RoleplayReservationReconciliationDecision =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INSPECT_STORAGE'
  | 'VERIFY_SERVER_EVIDENCE'
  | 'PUBLISHED_REQUIRES_CONFIRMATION'
  | 'CLOSED'
  | 'EXPIRED'
  | 'REVIEW_REQUIRED';

export class RoleplayUploadReconciliationError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'STORE_UNAVAILABLE') {
    // Never copy Prisma errors, user IDs, paths or upload credentials.
    super(code);
    this.name = 'RoleplayUploadReconciliationError';
  }
}

/**
 * Read-only reconciliation of a previous request, for a FUTURE authenticated
 * admin-only server service. No routes use this function yet.
 *
 * The caller MUST authenticate cookie and explicit Bearer as the SAME admin,
 * and enforce rate limits. This helper never creates reservations, reissues
 * upload tokens, returns batch identifiers, reads Storage objects, deletes
 * files or publishes a session. Decisions are hints for a trusted follow-up
 * process, not proof of storage integrity or a user-facing authorization.
 *
 * A missing row is NOT permission to retry with a new key: a prior network
 * timeout can leave an ambiguous outcome outside this read.
 */
export async function reconcileRoleplayDirectUploadReservation(
  db: Pick<PrismaClient, 'roleplayUploadReservation'>,
  actorUserId: string,
  requestKey: string,
  declarations: unknown,
  nowMs: number,
): Promise<{ decision: RoleplayReservationReconciliationDecision }> {
  if (!isRoleplayDirectUploadRequestKey(requestKey)) {
    throw new RoleplayUploadReconciliationError('INVALID_REQUEST');
  }
  let fingerprint: string;
  try {
    // Generates a throwaway UUID solely to reuse full validation; neither
    // that ID nor its staging paths are read from or written to the database.
    const { reservation } = prepareNewRoleplayUploadReservation(actorUserId, declarations, nowMs);
    fingerprint = fingerprintRoleplayDirectUploadDeclarations(reservation.items);
  } catch {
    throw new RoleplayUploadReconciliationError('INVALID_REQUEST');
  }

  let record: {
    actorUserId: string;
    declarationHash: string;
    status: string;
    createdAt: Date;
    expiresAt: Date;
  } | null;
  try {
    record = await db.roleplayUploadReservation.findUnique({
      where: { actorUserId_requestKey: { actorUserId, requestKey } },
      select: {
        actorUserId: true, declarationHash: true, status: true,
        createdAt: true, expiresAt: true,
      },
    });
  } catch {
    throw new RoleplayUploadReconciliationError('STORE_UNAVAILABLE');
  }
  if (!record) return { decision: 'NOT_FOUND' };
  if (record.actorUserId !== actorUserId ||
      record.declarationHash !== fingerprint) {
    return { decision: 'CONFLICT' };
  }

  // Reject unexpected/corrupt states and timestamps before acting on status.
  const created = record.createdAt instanceof Date ? record.createdAt.getTime() : NaN;
  const expires = record.expiresAt instanceof Date ? record.expiresAt.getTime() : NaN;
  if (!Number.isSafeInteger(created) || created <= 0 || created > nowMs ||
      !Number.isSafeInteger(expires) || expires <= created ||
      expires - created > 30 * 60 * 1000) {
    return { decision: 'REVIEW_REQUIRED' };
  }

  if (record.status === 'PUBLISHED') {
    // Status alone is not evidence that session creation committed. Always
    // check its server-owned publication reference before telling a client.
    return { decision: 'PUBLISHED_REQUIRES_CONFIRMATION' };
  }
  if (record.status === 'CANCELLED') return { decision: 'CLOSED' };
  if (!['RESERVED', 'VERIFYING', 'VERIFIED'].includes(record.status)) {
    return { decision: 'REVIEW_REQUIRED' };
  }
  if (nowMs >= expires) return { decision: 'EXPIRED' };
  if (record.status === 'VERIFIED') {
    // Verified flag is not sufficient: reload and verify ALL trusted evidence
    // before attempting atomic publication in a separate transaction.
    return { decision: 'VERIFY_SERVER_EVIDENCE' };
  }
  // RESERVED and VERIFYING both require an independent object inspection;
  // never resume by resending files without reconciling their Storage status.
  return { decision: 'INSPECT_STORAGE' };
}
