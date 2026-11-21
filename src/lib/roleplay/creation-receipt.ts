import type { PrismaClient } from '@prisma/client';
import { ROLEPLAY_MAX_SCENARIOS } from '@/lib/roleplay-limits';

// UUID v4/v7 only, as required by the durable creation-claim helper.
// The key is scoped by an authenticated administrator, never a bearer token.
const VALID_REQUEST_KEY = /^[a-f0-9]{8}-[a-f0-9]{4}-[47][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_RECEIPT_SESSIONS = 1000;

export class InvalidRoleplayReceiptRequestError extends Error {
  constructor() {
    super('INVALID_ROLEPLAY_RECEIPT_REQUEST');
    this.name = 'InvalidRoleplayReceiptRequestError';
  }
}

export function parseRoleplayReceiptRequest(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 || !('requestKey' in body) ||
      typeof body.requestKey !== 'string' || !VALID_REQUEST_KEY.test(body.requestKey)) {
    throw new InvalidRoleplayReceiptRequestError();
  }
  return body.requestKey;
}

export type RoleplayCreationReceipt =
  | { status: 'NOT_FOUND' }
  | { status: 'IN_PROGRESS' }
  | { status: 'REVIEW_REQUIRED' }
  | {
      status: 'COMPLETED';
      sessionIds: string[];
      createdCount: number;
      skippedCount: number;
      scenarioCount: number;
    };

/**
 * A read-only confirmation of one creation key owned by the authenticated
 * administrator. This does NOT claim the key, upload audio, advance a state,
 * or allow any retry. When a receipt is incomplete or references deleted
 * sessions, fail closed instead of claiming a successful publication.
 *
 * The caller must authenticate the actor (including explicit Bearer/cookie
 * identity matching) and the API must stay disabled until the migration was
 * deployed and verified in the correct PostgreSQL project.
 */
export async function lookupRoleplayCreationReceipt(
  db: Pick<PrismaClient, 'roleplayCreationRequest' | 'roleplaySession'>,
  actorUserId: string,
  requestKey: string,
): Promise<RoleplayCreationReceipt> {
  if (typeof actorUserId !== 'string' || !actorUserId.trim() ||
      actorUserId.length > 256) {
    throw new InvalidRoleplayReceiptRequestError();
  }
  parseRoleplayReceiptRequest({ requestKey });

  const entry = await db.roleplayCreationRequest.findUnique({
    where: { actorUserId_requestKey: { actorUserId, requestKey } },
    select: {
      status: true,
      sessionIds: true,
      createdCount: true,
      skippedCount: true,
      scenarioCount: true,
      completedAt: true,
    },
  });
  if (!entry) return { status: 'NOT_FOUND' };
  if (entry.status === 'IN_PROGRESS') return { status: 'IN_PROGRESS' };
  if (entry.status !== 'COMPLETED' ||
      !(entry.completedAt instanceof Date) || !Number.isFinite(entry.completedAt.getTime()) ||
      !Number.isSafeInteger(entry.createdCount) ||
      (entry.createdCount ?? 0) < 1 ||
      (entry.createdCount ?? 0) > MAX_RECEIPT_SESSIONS ||
      !Number.isSafeInteger(entry.skippedCount) || (entry.skippedCount ?? -1) < 0 ||
      !Number.isSafeInteger(entry.scenarioCount) ||
      (entry.scenarioCount ?? 0) < 1 ||
      (entry.scenarioCount ?? 0) > ROLEPLAY_MAX_SCENARIOS ||
      !Array.isArray(entry.sessionIds) ||
      entry.sessionIds.length !== entry.createdCount ||
      entry.sessionIds.some(id => typeof id !== 'string' || !id.trim()) ||
      new Set(entry.sessionIds).size !== entry.sessionIds.length) {
    return { status: 'REVIEW_REQUIRED' };
  }

  // A completed row is not enough by itself to claim the roleplay remains
  // available; check only IDs from the trusted ledger, without joining or
  // exposing participant names, emails, audio URLs or invitation secrets.
  const sessions = await db.roleplaySession.findMany({
    where: { id: { in: entry.sessionIds } },
    select: { id: true },
  });
  if (sessions.length !== entry.sessionIds.length ||
      new Set(sessions.map(session => session.id)).size !== entry.sessionIds.length ||
      sessions.some(session => !entry.sessionIds.includes(session.id))) {
    return { status: 'REVIEW_REQUIRED' };
  }

  return {
    status: 'COMPLETED',
    sessionIds: [...entry.sessionIds],
    createdCount: entry.createdCount!,
    skippedCount: entry.skippedCount!,
    scenarioCount: entry.scenarioCount!,
  };
}
