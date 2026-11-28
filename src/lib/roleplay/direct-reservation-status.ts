import type { PrismaClient } from '@prisma/client';
import { observePublishedInterpreterRoleplay } from './direct-upload-interpreter-recovery';
import { isRoleplayDirectUploadRequestKey, fingerprintRoleplayDirectUploadDeclarations } from './direct-upload-reservation-fingerprint';
import { prepareRoleplayDirectUploadBatch, type PreparedRoleplayUpload } from './direct-upload-contract';
import { ROLEPLAY_UPLOAD_RESERVATION_TTL_MS } from './direct-upload-reservation';
import { ROLEPLAY_DIRECT_UPLOAD_MAX_SLOTS } from '@/lib/roleplay-limits';
import type { TrustedRoleplayUploadEvidence } from './direct-upload-publication-gate';

export type DirectReservationStatus = 'NOT_FOUND' | 'RESERVED' | 'VERIFIED' | 'EXPIRED' |
  'PUBLICATION_RECORDED' | 'PUBLICATION_CONFIRMED' | 'CANCELLED' | 'REVIEW_REQUIRED';

export type DirectReservationRecordedProgress = {
  total: number;
  recordedVerifiedCount: number;
  expiresAt: string;
  observedAt: string;
};

export type DirectReservationStatusResult = {
  status: DirectReservationStatus;
  progress?: DirectReservationRecordedProgress;
  sessionId?: string;
};

/** Ledger observation only. No Storage observation, receipt verification,
 * signing, mutation or authorization to retry follows from this result. */
export async function lookupDirectReservationStatus(
  db: Pick<PrismaClient, 'roleplayUploadReservation' | 'roleplaySession' | '$queryRaw'>,
  actorUserId: string,
  requestKey: string,
  now = Date.now(),
): Promise<DirectReservationStatusResult> {
  if (!actorUserId.trim() || actorUserId.length > 256 || !isRoleplayDirectUploadRequestKey(requestKey)) {
    throw new Error('INVALID_RESERVATION_LOOKUP');
  }
  const row = await db.roleplayUploadReservation.findUnique({
    where: { actorUserId_requestKey: { actorUserId, requestKey } },
    select: { status: true, expiresAt: true, createdAt: true, id: true,
      declarationHash: true, items: true, verifiedObjects: true },
  });
  if (!row) return { status: 'NOT_FOUND' };
  // A published ledger row is not proof that the session still exists.
  // Expiration of a reservation does not erase a recorded publication.
  if (row.status === 'PUBLISHED') {
    try {
      const receipt = await observePublishedInterpreterRoleplay(db, actorUserId, requestKey);
      if (receipt) return { status: 'PUBLICATION_CONFIRMED', sessionId: receipt.sessionId };
    } catch { /* An unconfirmed receipt must never expose a session link. */ }
    return { status: 'PUBLICATION_RECORDED' };
  }
  if (row.status === 'CANCELLED') return { status: 'CANCELLED' };
  if (row.status !== 'RESERVED' && row.status !== 'VERIFIED') return { status: 'REVIEW_REQUIRED' };
  const expires = row.expiresAt instanceof Date ? row.expiresAt.getTime() : NaN;
  const created = row.createdAt instanceof Date ? row.createdAt.getTime() : NaN;
  if (!Number.isSafeInteger(now) || !Number.isFinite(expires) ||
      !Number.isFinite(created) || created <= 0 || created > now ||
      expires - created !== ROLEPLAY_UPLOAD_RESERVATION_TTL_MS) return { status: 'REVIEW_REQUIRED' };

  // Expose only bounded counts from a coherent, ordered ledger snapshot.
  // No filenames, hashes, object paths, tokens or raw evidence leave this helper.
  try {
    if (!Array.isArray(row.items) || row.items.length < 1 ||
        row.items.length > ROLEPLAY_DIRECT_UPLOAD_MAX_SLOTS ||
        !Array.isArray(row.verifiedObjects)) return { status: 'REVIEW_REQUIRED' };
    const stored = row.items as unknown as PreparedRoleplayUpload[];
    const { items } = prepareRoleplayDirectUploadBatch(row.id,
      stored.map(({ order, mime, sizeBytes, sha256 }) => ({ order, mime, sizeBytes, sha256 })));
    if (fingerprintRoleplayDirectUploadDeclarations(items) !== row.declarationHash ||
        items.some((item, i) => Object.entries(item).some(([key, value]) =>
          (stored[i] as unknown as Record<string, unknown>)[key] !== value))) return { status: 'REVIEW_REQUIRED' };
    const evidence = row.verifiedObjects as unknown as TrustedRoleplayUploadEvidence[];
    if (evidence.length > items.length || (row.status === 'VERIFIED') !== (evidence.length === items.length) ||
        evidence.some((proof, i) => !proof || Object.keys(proof).length !== 5 ||
          proof.order !== i || proof.path !== items[i].path || proof.sizeBytes !== items[i].sizeBytes ||
          proof.sha256 !== items[i].sha256 || !Number.isSafeInteger(proof.verifiedAtMs) ||
          proof.verifiedAtMs < created || proof.verifiedAtMs > now || proof.verifiedAtMs >= expires)) {
      return { status: 'REVIEW_REQUIRED' };
    }
    return {
      status: now >= expires ? 'EXPIRED' : row.status,
      progress: {
        total: items.length,
        recordedVerifiedCount: evidence.length,
        expiresAt: row.expiresAt.toISOString(),
        observedAt: new Date(now).toISOString(),
      },
    };
  } catch {
    return { status: 'REVIEW_REQUIRED' };
  }
}
