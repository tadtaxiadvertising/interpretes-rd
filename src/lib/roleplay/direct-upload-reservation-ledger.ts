import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prepareNewRoleplayUploadReservation } from '@/lib/roleplay/direct-upload-reservation';

type LedgerFailureCode = 'INVALID_REQUEST' | 'STORE_UNAVAILABLE';
const VALID_REQUEST_KEY = /^[a-f0-9]{8}-[a-f0-9]{4}-[47][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export class RoleplayUploadReservationLedgerError extends Error {
  constructor(readonly code: LedgerFailureCode) {
    // Never include identities, digests, Storage paths or Prisma exceptions.
    super(code);
    this.name = 'RoleplayUploadReservationLedgerError';
  }
}

export type RoleplayUploadReservationClaim =
  | { kind: 'CREATED'; batchId: string }
  | { kind: 'RECONCILE' }
  | { kind: 'CONFLICT' };

/**
 * Future server-only reservation claim, NOT called by any production route.
 *
 * A trusted HTTP layer must first require admin cookies, verify any explicit
 * Bearer is the SAME admin and impose admission/rate limits. A requestKey
 * identifies a retry, never authorizes a signed Storage upload. The model and
 * staging SQL must be deployed and verified before the first runtime call.
 *
 * Exactly one create() wins the (actor_user_id, request_key) UNIQUE constraint.
 * On duplicate, never issue another token or create another reservation,
 * including after expiry or a lost network response. A separate reconciliation
 * step must inspect server-side state and object references before recovery.
 */
export async function claimRoleplayDirectUploadReservation(
  db: Pick<PrismaClient, 'roleplayUploadReservation'>,
  actorUserId: string,
  requestKey: string,
  declarations: unknown,
  nowMs: number,
): Promise<RoleplayUploadReservationClaim> {
  if (typeof requestKey !== 'string' || !VALID_REQUEST_KEY.test(requestKey)) {
    throw new RoleplayUploadReservationLedgerError('INVALID_REQUEST');
  }

  let prepared: ReturnType<typeof prepareNewRoleplayUploadReservation>;
  try {
    prepared = prepareNewRoleplayUploadReservation(actorUserId, declarations, nowMs);
    if (!Number.isFinite(new Date(prepared.reservation.createdAtMs).getTime()) ||
        !Number.isFinite(new Date(prepared.reservation.expiresAtMs).getTime())) {
      throw new Error('invalid timestamp');
    }
  } catch {
    throw new RoleplayUploadReservationLedgerError('INVALID_REQUEST');
  }

  const { reservation } = prepared;
  // The idempotency fingerprint never contains filenames, roles, signed URLs
  // or patient information. It binds the exact ordered declared SHA values,
  // but remains UNTRUSTED until remote bytes are verified independently.
  const fingerprint = createHash('sha256').update(JSON.stringify({
    version: 1,
    items: reservation.items.map(({ order, mime, sizeBytes, sha256 }) =>
      ({ order, mime, sizeBytes, sha256 })),
  })).digest('hex');

  try {
    await db.roleplayUploadReservation.create({
      data: {
        id: reservation.batchId,
        actorUserId,
        requestKey,
        declarationHash: fingerprint,
        status: 'RESERVED',
        items: reservation.items as unknown as Prisma.InputJsonValue,
        verifiedObjects: [],
        createdAt: new Date(reservation.createdAtMs),
        expiresAt: new Date(reservation.expiresAtMs),
      },
      select: { id: true },
    });
    return { kind: 'CREATED', batchId: reservation.batchId };
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) ||
        error.code !== 'P2002') {
      throw new RoleplayUploadReservationLedgerError('STORE_UNAVAILABLE');
    }
  }

  try {
    const existing = await db.roleplayUploadReservation.findUnique({
      where: { actorUserId_requestKey: { actorUserId, requestKey } },
      select: { actorUserId: true, declarationHash: true, status: true },
    });
    if (!existing) return { kind: 'RECONCILE' };
    if (existing.actorUserId !== actorUserId ||
        existing.declarationHash !== fingerprint) {
      return { kind: 'CONFLICT' };
    }
    // RESERVED, VERIFYING, VERIFIED, CANCELLED, PUBLISHED, and unknown states
    // all require an explicit server-side reconciliation, NEVER an upload retry.
    return { kind: 'RECONCILE' };
  } catch {
    throw new RoleplayUploadReservationLedgerError('STORE_UNAVAILABLE');
  }
}
