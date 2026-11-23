import type { PrismaClient } from '@prisma/client';
import { prepareRoleplayDirectUploadBatch } from '@/lib/roleplay/direct-upload-contract';
import { prepareNewRoleplayUploadReservation } from '@/lib/roleplay/direct-upload-reservation';
import {
  fingerprintRoleplayDirectUploadDeclarations,
  isRoleplayDirectUploadRequestKey,
} from '@/lib/roleplay/direct-upload-reservation-fingerprint';
import {
  validRoleplayPublicationSessionIds,
} from '@/lib/roleplay/direct-upload-publication-receipt';

export type RoleplayUploadPublicationConfirmation =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'NOT_PUBLISHED'
  | 'REVIEW_REQUIRED'
  | 'REFERENCES_PRESENT_NEEDS_PROVENANCE_CHECK';

export class RoleplayPublicationConfirmationError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'STORE_UNAVAILABLE') {
    // Never include provider errors, identifiers, routes, user data or tokens.
    super(code);
    this.name = 'RoleplayPublicationConfirmationError';
  }
}

/**
 * A conservative, read-only structural verification after a lost HTTP reply.
 * NOT connected to HTTP or the current creation flow.
 *
 * The caller MUST authenticate the administrative cookie and any explicit
 * Bearer as the SAME actor, enforce request throttling, and check schema
 * readiness before use. This function never creates/deletes sessions, signs
 * Storage URLs, reads audio, returns IDs or asserts authorization.
 *
 * REFERENCES_PRESENT_NEEDS_PROVENANCE_CHECK means that every persisted
 * receipt ID exists with plausible first-audio and scenario structure;
 * it is NOT a replay receipt or proof of full audio integrity/ownership.
 * RoleplaySession has no createdBy admin field and RoleplayScenario currently
 * lacks a stable baseAudioPath. Final confirmation requires a new provenance
 * contract as well as trusted verification of every audio object.
 */
export async function inspectPublishedRoleplayUploadReferences(
  db: Pick<PrismaClient, 'roleplayUploadReservation' | 'roleplaySession'>,
  actorUserId: string,
  requestKey: string,
  declarations: unknown,
  nowMs: number,
): Promise<{ decision: RoleplayUploadPublicationConfirmation }> {
  if (!isRoleplayDirectUploadRequestKey(requestKey)) {
    throw new RoleplayPublicationConfirmationError('INVALID_REQUEST');
  }

  let fingerprint: string;
  let normalized: ReturnType<typeof prepareNewRoleplayUploadReservation>['reservation'];
  try {
    normalized = prepareNewRoleplayUploadReservation(actorUserId, declarations, nowMs).reservation;
    fingerprint = fingerprintRoleplayDirectUploadDeclarations(normalized.items);
  } catch {
    throw new RoleplayPublicationConfirmationError('INVALID_REQUEST');
  }

  let row: {
    id: string;
    actorUserId: string;
    declarationHash: string;
    status: string;
    items: unknown;
    publishedSessionIds: string[];
    createdAt: Date;
    expiresAt: Date;
  } | null;

  try {
    row = await db.roleplayUploadReservation.findUnique({
      where: { actorUserId_requestKey: { actorUserId, requestKey } },
      select: {
        id: true, actorUserId: true, declarationHash: true, status: true,
        items: true, publishedSessionIds: true, createdAt: true, expiresAt: true,
      },
    });
  } catch {
    throw new RoleplayPublicationConfirmationError('STORE_UNAVAILABLE');
  }

  if (!row) return { decision: 'NOT_FOUND' };
  if (row.actorUserId !== actorUserId || row.declarationHash !== fingerprint) {
    return { decision: 'CONFLICT' };
  }

  const created = row.createdAt instanceof Date ? row.createdAt.getTime() : NaN;
  const expires = row.expiresAt instanceof Date ? row.expiresAt.getTime() : NaN;
  if (!Number.isSafeInteger(created) || created <= 0 || created > nowMs ||
      !Number.isSafeInteger(expires) || expires <= created ||
      expires - created > 30 * 60_000) {
    return { decision: 'REVIEW_REQUIRED' };
  }

  if (row.status !== 'PUBLISHED') {
    // A nonterminal row with a receipt is corrupt; do not silently ignore it.
    return {
      decision: Array.isArray(row.publishedSessionIds) &&
        row.publishedSessionIds.length === 0 &&
        ['RESERVED', 'VERIFYING', 'VERIFIED', 'CANCELLED'].includes(row.status)
        ? 'NOT_PUBLISHED' : 'REVIEW_REQUIRED',
    };
  }

  if (!validRoleplayPublicationSessionIds(row.publishedSessionIds)) {
    return { decision: 'REVIEW_REQUIRED' };
  }

  let canonical: ReturnType<typeof prepareRoleplayDirectUploadBatch>;
  try {
    canonical = prepareRoleplayDirectUploadBatch(
      row.id,
      normalized.items.map(({ order, mime, sizeBytes, sha256 }) =>
        ({ order, mime, sizeBytes, sha256 })),
    );
  } catch {
    return { decision: 'REVIEW_REQUIRED' };
  }
  // A stored digest alone is insufficient: also reject altered paths, item
  // ordering, or unexpected columns inside persisted JSON.
  if (!Array.isArray(row.items) || row.items.length !== canonical.items.length) {
    return { decision: 'REVIEW_REQUIRED' };
  }
  const allowedKeys = ['order', 'mime', 'sizeBytes', 'sha256', 'path'];
  for (const [index, expected] of canonical.items.entries()) {
    const item = row.items[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { decision: 'REVIEW_REQUIRED' };
    }
    const actual = item as Record<string, unknown>;
    if (Object.keys(actual).length !== allowedKeys.length ||
        Object.keys(actual).some(key => !allowedKeys.includes(key)) ||
        allowedKeys.some(key => actual[key] !== expected[key as keyof typeof expected])) {
      return { decision: 'REVIEW_REQUIRED' };
    }
  }

  let sessions: Array<{
    id: string;
    status: string;
    baseAudioPath: string | null;
    scenarios: Array<{ order: number }>;
  }>;
  try {
    // All IDs originate from the admin-scoped DB receipt, never the request.
    // No people, emails, invite secrets, audio URLs or recordings are selected.
    sessions = await db.roleplaySession.findMany({
      where: { id: { in: row.publishedSessionIds } },
      select: {
        id: true,
        status: true,
        baseAudioPath: true,
        scenarios: { select: { order: true } },
      },
    });
  } catch {
    throw new RoleplayPublicationConfirmationError('STORE_UNAVAILABLE');
  }

  if (sessions.length !== row.publishedSessionIds.length ||
      new Set(sessions.map(session => session.id)).size !== row.publishedSessionIds.length ||
      sessions.some(session => !row!.publishedSessionIds.includes(session.id) ||
        session.status === 'DRAFT' ||
        session.baseAudioPath !== canonical.items[0].path ||
        !Array.isArray(session.scenarios) ||
        session.scenarios.length !== canonical.items.length ||
        new Set(session.scenarios.map(scenario => scenario.order)).size !== canonical.items.length ||
        session.scenarios.some(scenario => !Number.isSafeInteger(scenario.order) ||
          scenario.order < 0 || scenario.order >= canonical.items.length))) {
    return { decision: 'REVIEW_REQUIRED' };
  }

  // Never return session IDs or 'COMPLETED': ownership of each session and
  // every scenario's private object still requires independent provenance.
  return { decision: 'REFERENCES_PRESENT_NEEDS_PROVENANCE_CHECK' };
}
