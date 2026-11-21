import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ROLEPLAY_MAX_SCENARIOS, ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';
import { ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES } from '@/lib/roleplay/direct-upload-contract';
import { getAdminRoleplayAudioExtension } from '@/lib/roleplay/admin-audio-extension';
import { lookupRoleplayCreationReceipt } from '@/lib/roleplay/creation-receipt';

/**
 * A UUID identifies a retry, it is NOT an authorization capability.
 * Only the authenticated admin's server-side userId scopes the key.
 */
const VALID_REQUEST_KEY = /^[a-f0-9]{8}-[a-f0-9]{4}-[47][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const VALID_SHA256 = /^[a-f0-9]{64}$/;

export type RoleplayCreationAudioDigest = {
  mime: string;
  sizeBytes: number;
  sha256: string;
};

export type RoleplayCreationFingerprintInput = {
  participantType: 'interpreter' | 'candidate' | 'all-active-interpreters';
  participantId: number | null;
  /** Hash of the immutable server-verified library snapshot, if used. */
  libraryFingerprint: string | null;
  /** Validated, normalized scenario payload (ordered). */
  scenarios: readonly {
    title: string;
    durationLimitSec: number | null;
    scriptPrompt: string | null;
    studioTurn?: number | null;
    studioSpeaker?: string | null;
    studioLanguage?: string | null;
    sourceStartSec?: number | null;
    sourceEndSec?: number | null;
    expectedKeys?: readonly string[];
  }[];
  /** Verified SHA-256 for each byte stream. Empty only for verified library reuse. */
  audios: readonly RoleplayCreationAudioDigest[];
};

export class InvalidRoleplayCreationKeyError extends Error {
  constructor() {
    super('INVALID_ROLEPLAY_CREATION_KEY');
    this.name = 'InvalidRoleplayCreationKeyError';
  }
}

function validCreationIdentity(actorUserId: string, requestKey: string, payloadHash: string): boolean {
  return typeof actorUserId === 'string' && actorUserId.trim().length > 0 &&
    actorUserId.length <= 256 &&
    typeof requestKey === 'string' && VALID_REQUEST_KEY.test(requestKey) &&
    typeof payloadHash === 'string' && VALID_SHA256.test(payloadHash);
}

/**
 * Generate a deterministic, private fingerprint of the *validated content*.
 *
 * Never hash an unchecked user-provided digest for raw uploads: the future
 * caller must calculate each SHA from actual bytes with sha256RoleplayFile()
 * before claiming a key. Use the trusted library fingerprint for reuse.
 * Do not log the payload or expose its fingerprint to other administrators.
 */
export function fingerprintRoleplayCreation(
  input: RoleplayCreationFingerprintInput,
): string {
  if (!input || !['interpreter', 'candidate', 'all-active-interpreters'].includes(input.participantType) ||
      (input.participantType === 'all-active-interpreters'
        ? input.participantId !== null
        : !Number.isSafeInteger(input.participantId) || (input.participantId ?? 0) <= 0) ||
      !Array.isArray(input.scenarios) || input.scenarios.length < 1 ||
      input.scenarios.length > ROLEPLAY_MAX_SCENARIOS ||
      !Array.isArray(input.audios)) {
    throw new InvalidRoleplayCreationKeyError();
  }
  const isLibrary = input.libraryFingerprint !== null;
  if (isLibrary
    ? typeof input.libraryFingerprint !== 'string' || !VALID_SHA256.test(input.libraryFingerprint) ||
      input.audios.length !== 0
    : input.audios.length !== input.scenarios.length ||
      input.audios.some(audio =>
        !audio || typeof audio.mime !== 'string' || !getAdminRoleplayAudioExtension(audio.mime) ||
        !Number.isSafeInteger(audio.sizeBytes) || audio.sizeBytes < 1 ||
        audio.sizeBytes > ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES ||
        typeof audio.sha256 !== 'string' || !VALID_SHA256.test(audio.sha256))) {
    throw new InvalidRoleplayCreationKeyError();
  }
  for (const scenario of input.scenarios) {
    if (!scenario || typeof scenario.title !== 'string' ||
        scenario.title.trim().length < 1 || scenario.title.length > 200) {
      throw new InvalidRoleplayCreationKeyError();
    }
    // Reject non-string scenario metadata too: a future caller bypassing
    // validation could pass NaN in a string slot, which JSON.stringify
    // would silently serialize as null.
    if ((scenario.scriptPrompt !== null && typeof scenario.scriptPrompt !== 'string') ||
        (scenario.studioSpeaker != null && typeof scenario.studioSpeaker !== 'string') ||
        (scenario.studioLanguage != null && typeof scenario.studioLanguage !== 'string') ||
        (scenario.expectedKeys !== undefined &&
         (!Array.isArray(scenario.expectedKeys) ||
          scenario.expectedKeys.some((key: unknown) => typeof key !== 'string')))) {
      throw new InvalidRoleplayCreationKeyError();
    }
    // JSON.stringify silently serializes NaN and Infinity as null.
    // Reject malformed numeric metadata before hashing so a changed
    // scenario cannot collide with the legitimate null representation.
    if (scenario.durationLimitSec !== null &&
        (!Number.isSafeInteger(scenario.durationLimitSec) ||
         scenario.durationLimitSec < 1 ||
         scenario.durationLimitSec > ROLEPLAY_RESPONSE_MAX_DURATION_SEC)) {
      throw new InvalidRoleplayCreationKeyError();
    }
    if (scenario.studioTurn != null &&
        (!Number.isSafeInteger(scenario.studioTurn) ||
         scenario.studioTurn < 1 || scenario.studioTurn > 10000)) {
      throw new InvalidRoleplayCreationKeyError();
    }
    const start = scenario.sourceStartSec;
    const end = scenario.sourceEndSec;
    if ((start == null) !== (end == null) ||
        (start != null && end != null &&
         (!Number.isFinite(start) || !Number.isFinite(end) ||
          start < 0 || end > 7200 || end <= start))) {
      throw new InvalidRoleplayCreationKeyError();
    }
  }
  // Construct fields in a canonical order. The future runtime must pass
  // normalized scenarios, not raw FormData or File object metadata/names.
  const canonical = {
    version: 1,
    participantType: input.participantType,
    participantId: input.participantId,
    libraryFingerprint: input.libraryFingerprint,
    scenarios: input.scenarios.map(scenario => ({
      title: scenario.title.trim(),
      durationLimitSec: scenario.durationLimitSec,
      scriptPrompt: scenario.scriptPrompt,
      studioTurn: scenario.studioTurn ?? null,
      studioSpeaker: scenario.studioSpeaker ?? null,
      studioLanguage: scenario.studioLanguage ?? null,
      sourceStartSec: scenario.sourceStartSec ?? null,
      sourceEndSec: scenario.sourceEndSec ?? null,
      expectedKeys: scenario.expectedKeys ?? [],
    })),
    audios: input.audios.map(audio => ({
      mime: audio.mime,
      sizeBytes: audio.sizeBytes,
      sha256: audio.sha256,
    })),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export type RoleplayCreationClaim =
  | { kind: 'CLAIMED' }
  | { kind: 'IN_PROGRESS' }
  | { kind: 'CONFLICT' }
  | {
    kind: 'REPLAY';
    sessionIds: string[];
    createdCount: number;
    skippedCount: number;
    scenarioCount: number;
  };

/**
 * Claims a server-side, admin-scoped key using PostgreSQL UNIQUE semantics.
 * Two competing requests can never both create the same row. A duplicate
 * request is NEVER allowed to start another upload until it is reconciled.
 *
 * This function is not wired to POST yet. An activation must first:
 * 1) deploy and verify the migration;
 * 2) authenticate the admin and its optional Bearer identity;
 * 3) hash trusted actual audio bytes for a canonical fingerprint;
 * 4) finalize this row INSIDE the same transaction as session publishing;
 * 5) reconcile ambiguous IN_PROGRESS rows before considering any retry.
 */
export async function claimRoleplayCreation(
  db: Pick<PrismaClient, 'roleplayCreationRequest' | 'roleplaySession'>,
  actorUserId: string,
  requestKey: string,
  payloadHash: string,
): Promise<RoleplayCreationClaim> {
  if (!validCreationIdentity(actorUserId, requestKey, payloadHash)) {
    throw new InvalidRoleplayCreationKeyError();
  }
  const scope = { actorUserId, requestKey };
  const select = {
    actorUserId: true,
    payloadHash: true,
    status: true,
  } as const;

  try {
    await db.roleplayCreationRequest.create({
      data: { ...scope, payloadHash, status: 'IN_PROGRESS' },
      select: { id: true },
    });
    return { kind: 'CLAIMED' };
  } catch (error: unknown) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') {
      // A migration failure, DB outage or permission error is NOT equivalent
      // to an existing claim; fail closed without a second upload.
      throw error;
    }
  }

  const existing = await db.roleplayCreationRequest.findUnique({
    where: { actorUserId_requestKey: scope },
    select,
  });
  if (!existing) return { kind: 'IN_PROGRESS' };
  if (existing.actorUserId !== actorUserId || existing.payloadHash !== payloadHash) {
    return { kind: 'CONFLICT' };
  }
  if (existing.status !== 'COMPLETED') return { kind: 'IN_PROGRESS' };
  // The single receipt validator checks completion metadata AND verifies that
  // every referenced session still exists. An orphaned/corrupt ledger cannot
  // authorize a successful replay or a fresh upload.
  const receipt = await lookupRoleplayCreationReceipt(db, actorUserId, requestKey);
  if (receipt.status !== 'COMPLETED') return { kind: 'IN_PROGRESS' };
  return {
    kind: 'REPLAY',
    sessionIds: receipt.sessionIds,
    createdCount: receipt.createdCount,
    skippedCount: receipt.skippedCount,
    scenarioCount: receipt.scenarioCount,
  };
}


export type CompletedRoleplayCreation = {
  actorUserId: string;
  requestKey: string;
  payloadHash: string;
  sessionIds: readonly string[];
  skippedCount: number;
  scenarioCount: number;
};

/**
 * Run INSIDE the same Prisma $transaction that publishes the session(s).
 * If the conditional update affects no claim, throw so the caller's entire
 * publishing transaction rolls back. This is not a separate post-commit step.
 *
 * A repeated/parallel publisher cannot transition a completed row twice.
 * Do not attempt to recover an IN_PROGRESS row automatically after timeout;
 * reconcile its session/audio effects first.
 */
export async function completeRoleplayCreationInTransaction(
  tx: Pick<Prisma.TransactionClient, 'roleplayCreationRequest'>,
  result: CompletedRoleplayCreation,
): Promise<void> {
  if (!result || !validCreationIdentity(result.actorUserId, result.requestKey, result.payloadHash) ||
      !Array.isArray(result.sessionIds) || result.sessionIds.length < 1 ||
      result.sessionIds.length > 100000 ||
      result.sessionIds.some(id => typeof id !== 'string' || !id.trim()) ||
      new Set(result.sessionIds).size !== result.sessionIds.length ||
      !Number.isSafeInteger(result.skippedCount) || result.skippedCount < 0 ||
      !Number.isSafeInteger(result.scenarioCount) || result.scenarioCount < 1 ||
      result.scenarioCount > ROLEPLAY_MAX_SCENARIOS) {
    throw new InvalidRoleplayCreationKeyError();
  }

  const updated = await tx.roleplayCreationRequest.updateMany({
    where: {
      actorUserId: result.actorUserId,
      requestKey: result.requestKey,
      payloadHash: result.payloadHash,
      status: 'IN_PROGRESS',
    },
    data: {
      status: 'COMPLETED',
      sessionIds: [...result.sessionIds],
      createdCount: result.sessionIds.length,
      skippedCount: result.skippedCount,
      scenarioCount: result.scenarioCount,
      completedAt: new Date(),
    },
  });
  if (updated.count !== 1) {
    // Conflict, already completed, absent or tampered claim. An enclosing
    // transaction must abort, rather than risk publishing duplicate sessions.
    throw new InvalidRoleplayCreationKeyError();
  }
}
