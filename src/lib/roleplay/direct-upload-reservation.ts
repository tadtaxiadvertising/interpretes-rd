import { randomUUID } from 'node:crypto';
import {
  prepareRoleplayDirectUploadBatch,
} from '@/lib/roleplay/direct-upload-contract';
import type { RoleplayUploadReservationSnapshot } from '@/lib/roleplay/direct-upload-publication-gate';

// Bound the time during which a future authenticated upload may be completed.
// Signing tokens may have an independent, shorter lifetime.
export const ROLEPLAY_UPLOAD_RESERVATION_TTL_MS = 30 * 60 * 1000;

export class RoleplayReservationPreparationError extends Error {
  constructor() {
    // Do not copy the actor ID, file names or malformed declarations into logs.
    super('INVALID_ROLEPLAY_UPLOAD_RESERVATION');
    this.name = 'RoleplayReservationPreparationError';
  }
}

/**
 * Construct an unpersisted, server-owned reservation from declarations.
 *
 * This helper does NOT authenticate a request, reserve a database row, issue a
 * signed upload token or interact with Storage. A future route MUST first
 * authenticate the admin (and any explicit Bearer identity), then persist
 * the entire snapshot atomically with actor-scoped idempotency before issuing
 * any signed capabilities. Never treat the returned UUID as authorization.
 *
 * No UUID, path, owner or expiration supplied by a browser is accepted here:
 * the server generates canonical staging paths and records its own clock.
 */
export function prepareNewRoleplayUploadReservation(
  actorUserId: string,
  declarations: unknown,
  nowMs: number,
): { reservation: RoleplayUploadReservationSnapshot; totalBytes: number } {
  if (typeof actorUserId !== 'string' || !actorUserId.trim() ||
      actorUserId.length > 256 || /[\u0000-\u001f\u007f]/.test(actorUserId) ||
      !Number.isSafeInteger(nowMs) || nowMs <= 0 ||
      nowMs > Number.MAX_SAFE_INTEGER - ROLEPLAY_UPLOAD_RESERVATION_TTL_MS) {
    throw new RoleplayReservationPreparationError();
  }

  try {
    // A cryptographically random UUID is an identifier, never an access token.
    const batchId = randomUUID();
    const prepared = prepareRoleplayDirectUploadBatch(batchId, declarations);
    return {
      reservation: {
        batchId,
        ownerUserId: actorUserId,
        status: 'RESERVED',
        createdAtMs: nowMs,
        expiresAtMs: nowMs + ROLEPLAY_UPLOAD_RESERVATION_TTL_MS,
        items: prepared.items,
      },
      totalBytes: prepared.totalBytes,
    };
  } catch {
    throw new RoleplayReservationPreparationError();
  }
}
