import type { PrismaClient } from '@prisma/client';
import { isRoleplayDirectUploadRequestKey } from './direct-upload-reservation-fingerprint';

export type DirectReservationStatus = 'NOT_FOUND' | 'RESERVED' | 'VERIFIED' | 'EXPIRED' |
  'PUBLICATION_RECORDED' | 'CANCELLED' | 'REVIEW_REQUIRED';

/** Ledger observation only. No Storage observation, receipt verification,
 * signing, mutation or authorization to retry follows from this result. */
export async function lookupDirectReservationStatus(
  db: Pick<PrismaClient, 'roleplayUploadReservation'>,
  actorUserId: string,
  requestKey: string,
  now = Date.now(),
): Promise<{ status: DirectReservationStatus }> {
  if (!actorUserId.trim() || actorUserId.length > 256 || !isRoleplayDirectUploadRequestKey(requestKey)) {
    throw new Error('INVALID_RESERVATION_LOOKUP');
  }
  const row = await db.roleplayUploadReservation.findUnique({
    where: { actorUserId_requestKey: { actorUserId, requestKey } },
    select: { status: true, expiresAt: true },
  });
  if (!row) return { status: 'NOT_FOUND' };
  // A published ledger row is not proof that the session still exists.
  // Expiration of a reservation does not erase a recorded publication.
  if (row.status === 'PUBLISHED') return { status: 'PUBLICATION_RECORDED' };
  if (row.status === 'CANCELLED') return { status: 'CANCELLED' };
  if (row.status !== 'RESERVED' && row.status !== 'VERIFIED') return { status: 'REVIEW_REQUIRED' };
  const expires = row.expiresAt instanceof Date ? row.expiresAt.getTime() : NaN;
  if (!Number.isFinite(expires) || !Number.isFinite(now)) return { status: 'REVIEW_REQUIRED' };
  if (now >= expires) return { status: 'EXPIRED' };
  return { status: row.status };
}
