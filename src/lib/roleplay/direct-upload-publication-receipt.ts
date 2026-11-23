import type { Prisma } from '@prisma/client';
import { fingerprintRoleplayDirectUploadDeclarations, isRoleplayDirectUploadRequestKey } from '@/lib/roleplay/direct-upload-reservation-fingerprint';
import {
  validateRoleplayDirectUploadPublication,
  type RoleplayUploadReservationSnapshot,
  type TrustedRoleplayUploadEvidence,
} from '@/lib/roleplay/direct-upload-publication-gate';

export class RoleplayPublicationReceiptError extends Error {
  constructor(readonly code: 'INVALID_RECEIPT' | 'NOT_CLAIMED' | 'STORE_UNAVAILABLE') {
    // Do not echo session IDs, paths, identities or provider exceptions.
    super(code);
    this.name = 'RoleplayPublicationReceiptError';
  }
}

/**
 * FUTURE server-only transaction step. NO active route calls this helper.
 *
 * The authenticated caller must load reservation and evidence from trusted DB
 * state, create ALL Roleplay sessions inside the SAME enclosing Prisma
 * $transaction, then call this function. If it throws, the caller MUST throw
 * out of $transaction to roll back the session creation and this update.
 * Never call as a post-commit operation or with client-supplied evidence.
 *
 * The conditional VERIFIED -> PUBLISHED update is the last action; a parallel
 * publisher cannot claim it twice. This is only a ledger receipt, not proof
 * that a session exists unless the surrounding transaction creates/links it.
 */
export async function completeRoleplayUploadPublicationInTransaction(
  tx: Pick<Prisma.TransactionClient, 'roleplayUploadReservation'>,
  input: {
    actorUserId: string;
    requestKey: string;
    reservation: RoleplayUploadReservationSnapshot;
    verifiedObjects: readonly TrustedRoleplayUploadEvidence[];
    sessionIds: readonly string[];
    nowMs: number;
  },
): Promise<void> {
  let batchId: string;
  let declarationHash: string;
  try {
    if (!input || !isRoleplayDirectUploadRequestKey(input.requestKey) ||
        !Array.isArray(input.sessionIds) || input.sessionIds.length < 1 ||
        input.sessionIds.length > 100000 ||
        input.sessionIds.some(id => typeof id !== 'string' ||
          !/^[a-zA-Z0-9_-]{5,120}$/.test(id)) ||
        new Set(input.sessionIds).size !== input.sessionIds.length) {
      throw new Error('invalid receipt');
    }
    const validated = validateRoleplayDirectUploadPublication(
      input.reservation, input.verifiedObjects, input.actorUserId, input.nowMs,
    );
    batchId = validated.batchId;
    declarationHash = fingerprintRoleplayDirectUploadDeclarations(validated.items);
  } catch {
    throw new RoleplayPublicationReceiptError('INVALID_RECEIPT');
  }

  let updated: { count: number };
  try {
    updated = await tx.roleplayUploadReservation.updateMany({
      where: {
        id: batchId,
        actorUserId: input.actorUserId,
        requestKey: input.requestKey,
        declarationHash,
        status: 'VERIFIED',
        createdAt: { lte: new Date(input.nowMs) },
        expiresAt: { gt: new Date(input.nowMs) },
      },
      data: {
        status: 'PUBLISHED',
        publishedSessionIds: [...input.sessionIds],
      },
    });
  } catch {
    throw new RoleplayPublicationReceiptError('STORE_UNAVAILABLE');
  }
  if (updated.count !== 1) {
    // The enclosing transaction MUST roll back any created sessions as well.
    throw new RoleplayPublicationReceiptError('NOT_CLAIMED');
  }
}
