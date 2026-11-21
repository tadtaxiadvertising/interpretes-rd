import {
  prepareRoleplayDirectUploadBatch,
  type PreparedRoleplayUpload,
} from '@/lib/roleplay/direct-upload-contract';

export type RoleplayUploadReservationStatus =
  'RESERVED' | 'VERIFYING' | 'VERIFIED' | 'PUBLISHED' | 'CANCELLED';

export interface RoleplayUploadReservationSnapshot {
  /** Persisted, server-generated ID, never accepted as an authorization token. */
  batchId: string;
  ownerUserId: string;
  status: RoleplayUploadReservationStatus;
  expiresAtMs: number;
  items: readonly PreparedRoleplayUpload[];
}

/** Evidence from a TRUSTED verifier, loaded server-side, never from client JSON. */
export interface TrustedRoleplayUploadEvidence {
  order: number;
  path: string;
  sizeBytes: number;
  sha256: string;
  verifiedAtMs: number;
}

type PublicationBlockCode =
  'INVALID_RESERVATION' | 'NOT_OWNER' | 'EXPIRED' |
  'NOT_VERIFIED' | 'EVIDENCE_MISMATCH';

export class RoleplayPublicationBlockedError extends Error {
  constructor(readonly code: PublicationBlockCode) {
    // Keep error messages independent of identity, object keys and PII.
    super(code);
    this.name = 'RoleplayPublicationBlockedError';
  }
}

/**
 * Pure, fail-closed preflight of an ENTIRE reserved direct-upload batch.
 *
 * The authenticated caller MUST load both the reservation and verification
 * evidence from trusted persistent storage; never accept either from the
 * browser. This routine does not create evidence, authorize Storage access,
 * issue signed URLs, mutate the database, or publish roleplays.
 *
 * A later service must claim/commit the VERIFIED reservation atomically with
 * a database compare-and-swap inside its publishing transaction. This pure
 * check cannot enforce idempotency or prevent two concurrent publishers.
 */
export function validateRoleplayDirectUploadPublication(
  reservation: RoleplayUploadReservationSnapshot,
  verifiedObjects: readonly TrustedRoleplayUploadEvidence[],
  actorUserId: string,
  nowMs: number,
): { batchId: string; totalBytes: number; items: PreparedRoleplayUpload[] } {
  if (!reservation || typeof reservation !== 'object' ||
      typeof actorUserId !== 'string' || !actorUserId.trim() ||
      typeof reservation.ownerUserId !== 'string' || !reservation.ownerUserId.trim()) {
    throw new RoleplayPublicationBlockedError('INVALID_RESERVATION');
  }
  if (reservation.ownerUserId !== actorUserId) {
    throw new RoleplayPublicationBlockedError('NOT_OWNER');
  }
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 ||
      !Number.isSafeInteger(reservation.expiresAtMs) || reservation.expiresAtMs <= 0) {
    throw new RoleplayPublicationBlockedError('INVALID_RESERVATION');
  }
  if (nowMs >= reservation.expiresAtMs) {
    throw new RoleplayPublicationBlockedError('EXPIRED');
  }
  if (reservation.status !== 'VERIFIED') {
    throw new RoleplayPublicationBlockedError('NOT_VERIFIED');
  }

  let canonical: ReturnType<typeof prepareRoleplayDirectUploadBatch>;
  try {
    // Reconstruct all allowed paths and sizes from the server-owned batch ID;
    // a persisted path must match the canonical namespace exactly.
    const declarations = reservation.items.map(({ order, mime, sizeBytes, sha256 }) =>
      ({ order, mime, sizeBytes, sha256 }));
    canonical = prepareRoleplayDirectUploadBatch(reservation.batchId, declarations);
    if (canonical.items.some((item, index) => item.path !== reservation.items[index].path)) {
      throw new Error('noncanonical reservation path');
    }
  } catch {
    throw new RoleplayPublicationBlockedError('INVALID_RESERVATION');
  }

  if (!Array.isArray(verifiedObjects) || verifiedObjects.length !== canonical.items.length) {
    throw new RoleplayPublicationBlockedError('EVIDENCE_MISMATCH');
  }

  const allowedFields = new Set(['order', 'path', 'sizeBytes', 'sha256', 'verifiedAtMs']);
  for (const [index, expected] of canonical.items.entries()) {
    const evidence = verifiedObjects[index];
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) ||
        Object.keys(evidence).length !== allowedFields.size ||
        Object.keys(evidence).some(key => !allowedFields.has(key)) ||
        evidence.order !== index || evidence.path !== expected.path ||
        evidence.sizeBytes !== expected.sizeBytes ||
        evidence.sha256 !== expected.sha256 ||
        !Number.isSafeInteger(evidence.verifiedAtMs) ||
        evidence.verifiedAtMs <= 0 || evidence.verifiedAtMs > nowMs ||
        evidence.verifiedAtMs >= reservation.expiresAtMs) {
      throw new RoleplayPublicationBlockedError('EVIDENCE_MISMATCH');
    }
  }

  return {
    batchId: reservation.batchId,
    totalBytes: canonical.totalBytes,
    // Return canonical paths, never unchecked values from stored evidence.
    items: canonical.items,
  };
}
