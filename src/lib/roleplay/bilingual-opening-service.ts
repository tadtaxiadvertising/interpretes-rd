import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { createSignedBilingualOpeningUploadUrl } from '@/lib/roleplay';
import { verifyBilingualOpeningAudio } from './bilingual-opening-storage';
import {
  reserveBilingualOpeningPath, claimBilingualOpeningVerification,
  completeBilingualOpeningVerification, readBilingualOpeningState, readBilingualOpeningRecovery,
  discardBilingualOpeningReservation, type BilingualOpeningActor,
} from './bilingual-opening-store';

type Store = Pick<PrismaClient, '$transaction'>;

/**
 * Staged service, not an HTTP action. The caller must obtain actor from
 * authenticated server identity and cookie, and enforce admission limits.
 * The database schema must be deployed and checked before enabling routes.
 */
export async function authorizeOpeningUpload(
  db: Store, sessionId: string, actor: BilingualOpeningActor,
  input: { mimeType: string; size: number },
) {
  return createSignedBilingualOpeningUploadUrl(sessionId, input.mimeType, input.size,
    path => reserveBilingualOpeningPath(db, sessionId, actor, path));
}

/** Browser supplies only a previously reserved path, never measured duration. */
export async function confirmOpeningUpload(
  db: Store, sessionId: string, actor: BilingualOpeningActor, path: string,
): Promise<'created' | 'replayed'> {
  const claim = await claimBilingualOpeningVerification(db, sessionId, actor, path);
  if (claim.kind === 'replayed') return 'replayed';
  // Decode outside the database transaction. A failed attempt leaves a short
  // verification lease, preventing immediate retry storms. Recovery may retry
  // once the lease expires, while the upload reservation remains valid.
  const evidence = await verifyBilingualOpeningAudio(sessionId, path);
  return completeBilingualOpeningVerification(db, sessionId, actor, claim.verificationId, evidence);
}

export async function recoverOpeningState(db: Store, sessionId: string, actor: BilingualOpeningActor) {
  return readBilingualOpeningState(db, sessionId, actor);
}

export async function recoverOpeningDetails(db: Store, sessionId: string, actor: BilingualOpeningActor) {
  return readBilingualOpeningRecovery(db, sessionId, actor);
}

export async function discardOpeningUpload(db: Store, sessionId: string, actor: BilingualOpeningActor, path: string) {
  return discardBilingualOpeningReservation(db, sessionId, actor, path);
}
