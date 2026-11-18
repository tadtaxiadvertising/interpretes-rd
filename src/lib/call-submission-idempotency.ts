import { createHash } from 'node:crypto';

/**
 * Server-side contract ONLY. It does not query or create the staged
 * call_submission_keys table and MUST NOT be wired into a live write route
 * before the production schema has been explicitly verified.
 *
 * v1 only covers the two Quick Log routes. Admin manual calls include a
 * user-selected timestamp and notes and will require a distinct contract.
 */
export type QuickLogSubmissionSource = 'quick_log_action' | 'quick_log_api';

export interface QuickLogSubmission {
  interpreterId: number;
  source: QuickLogSubmissionSource;
  durationSeconds: number;
}

// Existing Quick Log API accepts at most 100,000 minutes plus 59 seconds.
// The same key may only refer to the *same* duration in whole seconds.
export const MAX_QUICK_LOG_SECONDS = 100_000 * 60 + 59;
export const QUICK_LOG_FINGERPRINT_VERSION = 1;

// UUIDv4 from a cryptographically secure generator per user intent.
// A stable random key must be reused ONLY for replays of that intent.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_SOURCES: readonly string[] = ['quick_log_action', 'quick_log_api'];

export function normalizeQuickLogRequestKey(value: unknown): string | null {
  if (typeof value !== 'string' || !UUID_V4.test(value)) return null;
  // PostgreSQL's uuid column is case-insensitive, so canonicalize to lowercase.
  return value.toLowerCase();
}

export function fingerprintQuickLogSubmission(payload: QuickLogSubmission): string {
  if (
    !Number.isSafeInteger(payload.interpreterId) || payload.interpreterId <= 0 ||
    !ALLOWED_SOURCES.includes(payload.source) ||
    !Number.isSafeInteger(payload.durationSeconds) ||
    payload.durationSeconds <= 0 ||
    payload.durationSeconds > MAX_QUICK_LOG_SECONDS
  ) {
    // Never echo submitted keys, identities or any raw user-provided fields.
    throw new Error('Invalid Quick Log idempotency payload');
  }

  // Exact tuple ordering is part of the protocol; altering it requires v2.
  // Only a numeric internal ID, a fixed server-authorized source and an
  // integer duration are hashed. Do not include notes, email, names, tokens,
  // timestamps or current tariffs (a legitimate retry may have a new tariff).
  const canonical = JSON.stringify([
    'interpretes-rd-call-submission',
    QUICK_LOG_FINGERPRINT_VERSION,
    payload.interpreterId,
    payload.source,
    payload.durationSeconds,
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export interface ExistingQuickLogKey {
  interpreterId: number;
  requestKey: string;
  source: string;
  payloadSha256: string;
  callSessionId: number;
}

export type QuickLogReplayDecision =
  | { kind: 'NEW' }
  | { kind: 'REPLAY'; callSessionId: number }
  | { kind: 'CONFLICT' };

/**
 * Pure classification after reading the staged mapping from the database.
 *
 * NEW is advisory only: never do check-then-insert without a database unique
 * constraint and a Serializable transaction. The eventual writer must insert
 * the call, daily log, ledger and mapping ATOMICALLY; a unique-key race must
 * roll back its entire attempt and perform a new mapping read.
 */
export function classifyQuickLogReplay(
  existing: ExistingQuickLogKey | null,
  requestKey: unknown,
  payload: QuickLogSubmission,
): QuickLogReplayDecision {
  const normalizedKey = normalizeQuickLogRequestKey(requestKey);
  if (!normalizedKey) return { kind: 'CONFLICT' };
  const digest = fingerprintQuickLogSubmission(payload);
  if (!existing) return { kind: 'NEW' };

  if (
    existing.interpreterId !== payload.interpreterId ||
    normalizeQuickLogRequestKey(existing.requestKey) !== normalizedKey ||
    existing.source !== payload.source ||
    existing.payloadSha256 !== digest ||
    !Number.isSafeInteger(existing.callSessionId) ||
    existing.callSessionId <= 0
  ) {
    return { kind: 'CONFLICT' };
  }

  return { kind: 'REPLAY', callSessionId: existing.callSessionId };
}
