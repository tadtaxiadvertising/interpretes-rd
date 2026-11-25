import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { getBilingualOpeningState, isCanonicalBilingualOpeningPath } from './bilingual-opening';

export type BilingualOpeningActor = { role: 'candidate'; candidateId: number; sessionCookie: string | null }
  | { role: 'interpreter'; interpreterId: number };
type SessionRow = {
  id: string;
  required: boolean;
  status: string;
  currentIndex: number;
  candidateId: number | null;
  interpreterId: number | null;
};
type OpeningRow = {
  sourceAudioPath: string;
  durationSec: number;
  confirmedAt: Date;
};
type AccessRow = { validatedAt: Date | null; usedAt: Date | null; expiresAt: Date };
type Store = Pick<PrismaClient, '$transaction'>;
type Tx = Pick<Prisma.TransactionClient, '$queryRaw'>;

export class BilingualOpeningStoreError extends Error {
  constructor(readonly code: 'FORBIDDEN' | 'INVALID_EVIDENCE' | 'CONFLICT' | 'STORE_UNAVAILABLE') {
    super(code);
    this.name = 'BilingualOpeningStoreError';
  }
}

// Future server-only adapter. Deliberately not called by any live route.
// Raw parameterized queries isolate the staged schema from existing Prisma
// model queries until an additive schema rollout is verified.
async function lockAuthorizedSession(tx: Tx, sessionId: string, actor: BilingualOpeningActor): Promise<SessionRow> {
  const [session] = await tx.$queryRaw<SessionRow[]>`
    SELECT id, requires_bilingual_opening AS required, status::text AS status,
      current_scenario_index AS "currentIndex",
      recruitment_candidate_id AS "candidateId", interpreter_id AS "interpreterId"
    FROM public.roleplay_sessions WHERE id = ${sessionId} FOR UPDATE
  `;
  if (!session || session.id !== sessionId ||
      !['STARTED', 'IN_PROGRESS'].includes(session.status)) {
    throw new BilingualOpeningStoreError('FORBIDDEN');
  }
  if (session.candidateId !== null) {
    if (actor.role !== 'candidate' || !Number.isSafeInteger(actor.candidateId) ||
        actor.candidateId <= 0 || actor.candidateId !== session.candidateId ||
        actor.sessionCookie !== sessionId) throw new BilingualOpeningStoreError('FORBIDDEN');
    const [access] = await tx.$queryRaw<AccessRow[]>`
      SELECT validated_at AS "validatedAt", used_at AS "usedAt", expires_at AS "expiresAt"
      FROM public.roleplay_access WHERE session_id = ${sessionId} FOR UPDATE
    `;
    if (!access?.validatedAt || access.usedAt ||
        !(access.expiresAt instanceof Date) || !(access.expiresAt.getTime() > Date.now())) {
      throw new BilingualOpeningStoreError('FORBIDDEN');
    }
  } else if (actor.role !== 'interpreter' || !Number.isSafeInteger(actor.interpreterId) ||
      actor.interpreterId <= 0 || actor.interpreterId !== session.interpreterId) {
    throw new BilingualOpeningStoreError('FORBIDDEN');
  }
  return session;
}

async function readOpening(tx: Tx, sessionId: string): Promise<OpeningRow | null> {
  const [row] = await tx.$queryRaw<OpeningRow[]>`
    SELECT source_audio_path AS "sourceAudioPath", duration_sec AS "durationSec",
      confirmed_at AS "confirmedAt"
    FROM public.roleplay_bilingual_openings WHERE session_id = ${sessionId}
  `;
  return row ?? null;
}

export async function readBilingualOpeningState(db: Store, sessionId: string, actor: BilingualOpeningActor) {
  try {
    return await db.$transaction(async tx => {
      const session = await lockAuthorizedSession(tx, sessionId, actor);
      if (!session.required) return 'not-required' as const;
      return getBilingualOpeningState(sessionId, true, await readOpening(tx, sessionId));
    });
  } catch (error) {
    if (error instanceof BilingualOpeningStoreError) throw error;
    throw new BilingualOpeningStoreError('STORE_UNAVAILABLE');
  }
}

/**
 * Called only after a trusted server verifies the actual uploaded object and
 * measured duration. Never expose this adapter directly as a Server Action
 * or accept an actor or verified evidence from browser JSON.
 * The locked session serializes confirmation with session progression.
 */
export async function confirmVerifiedBilingualOpening(
  db: Store, sessionId: string, actor: BilingualOpeningActor,
  evidence: { sourceAudioPath: string; durationSec: number },
): Promise<'created' | 'replayed'> {
  const confirmedAt = new Date();
  if (getBilingualOpeningState(sessionId, true, { ...evidence, confirmedAt }) !== 'confirmed') {
    throw new BilingualOpeningStoreError('INVALID_EVIDENCE');
  }
  try {
    return await db.$transaction(async tx => {
      const session = await lockAuthorizedSession(tx, sessionId, actor);
      if (!session.required) throw new BilingualOpeningStoreError('FORBIDDEN');
      const existing = await readOpening(tx, sessionId);
      if (existing) {
        if (getBilingualOpeningState(sessionId, true, existing) === 'confirmed' &&
            existing.sourceAudioPath === evidence.sourceAudioPath &&
            existing.durationSec === evidence.durationSec) return 'replayed';
        throw new BilingualOpeningStoreError('CONFLICT');
      }
      if (session.currentIndex !== 0) throw new BilingualOpeningStoreError('FORBIDDEN');
      const rows = await tx.$queryRaw<{ sessionId: string }[]>`
        INSERT INTO public.roleplay_bilingual_openings
          (session_id, source_audio_path, duration_sec, confirmed_at)
        VALUES (${sessionId}, ${evidence.sourceAudioPath}, ${evidence.durationSec}, ${confirmedAt})
        ON CONFLICT (session_id) DO NOTHING
        RETURNING session_id AS "sessionId"
      `;
      if (rows.length !== 1 || rows[0].sessionId !== sessionId) {
        throw new BilingualOpeningStoreError('CONFLICT');
      }
      return 'created';
    });
  } catch (error) {
    if (error instanceof BilingualOpeningStoreError) throw error;
    throw new BilingualOpeningStoreError('STORE_UNAVAILABLE');
  }
}

const RESERVATION_MS = 10 * 60_000;
const VERIFICATION_MS = 120_000;
type ReservationRow = { sourceAudioPath: string; expiresAt: Date; verificationId: string | null; verificationUntil: Date | null };

async function readReservation(tx: Tx, sessionId: string): Promise<ReservationRow | null> {
  const [row] = await tx.$queryRaw<ReservationRow[]>`
    SELECT source_audio_path AS "sourceAudioPath", expires_at AS "expiresAt",
      verification_id::text AS "verificationId", verification_until AS "verificationUntil"
    FROM public.roleplay_bilingual_opening_reservations WHERE session_id = ${sessionId}
  `;
  return row ?? null;
}

async function openingTransaction<T>(db: Store, callback: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.$transaction(callback);
  } catch (error) {
    if (error instanceof BilingualOpeningStoreError) throw error;
    throw new BilingualOpeningStoreError('STORE_UNAVAILABLE');
  }
}

/** Reserve one immutable object before minting any upload capability. */
export async function reserveBilingualOpeningPath(
  db: Store, sessionId: string, actor: BilingualOpeningActor, path: string,
): Promise<void> {
  if (!isCanonicalBilingualOpeningPath(path, sessionId)) throw new BilingualOpeningStoreError('INVALID_EVIDENCE');
  await openingTransaction(db, async tx => {
    const session = await lockAuthorizedSession(tx, sessionId, actor);
    if (!session.required || session.currentIndex !== 0 || await readOpening(tx, sessionId)) {
      throw new BilingualOpeningStoreError('FORBIDDEN');
    }
    const existing = await readReservation(tx, sessionId);
    const now = new Date();
    if (existing && existing.expiresAt > now) throw new BilingualOpeningStoreError('CONFLICT');
    const expires = new Date(now.getTime() + RESERVATION_MS);
    const rows = await tx.$queryRaw<{ sessionId: string }[]>`
      INSERT INTO public.roleplay_bilingual_opening_reservations (session_id, source_audio_path, expires_at)
      VALUES (${sessionId}, ${path}, ${expires})
      ON CONFLICT (session_id) DO UPDATE SET source_audio_path = EXCLUDED.source_audio_path,
        expires_at = EXCLUDED.expires_at, verification_id = NULL, verification_until = NULL
      WHERE public.roleplay_bilingual_opening_reservations.expires_at <= ${now}
      RETURNING session_id AS "sessionId"
    `;
    if (rows.length !== 1 || rows[0].sessionId !== sessionId) throw new BilingualOpeningStoreError('CONFLICT');
  });
}

/** Claim verification before any storage download or CPU-intensive decoding. */
export async function claimBilingualOpeningVerification(
  db: Store, sessionId: string, actor: BilingualOpeningActor, path: string,
): Promise<{ kind: 'claimed'; verificationId: string } | { kind: 'replayed' }> {
  if (!isCanonicalBilingualOpeningPath(path, sessionId)) throw new BilingualOpeningStoreError('INVALID_EVIDENCE');
  return openingTransaction(db, async tx => {
    const session = await lockAuthorizedSession(tx, sessionId, actor);
    if (!session.required) throw new BilingualOpeningStoreError('FORBIDDEN');
    const opening = await readOpening(tx, sessionId);
    if (opening) {
      if (opening.sourceAudioPath === path && getBilingualOpeningState(sessionId, true, opening) === 'confirmed') {
        return { kind: 'replayed' };
      }
      throw new BilingualOpeningStoreError('CONFLICT');
    }
    if (session.currentIndex !== 0) throw new BilingualOpeningStoreError('FORBIDDEN');
    const reservation = await readReservation(tx, sessionId);
    const now = new Date();
    const until = new Date(now.getTime() + VERIFICATION_MS);
    if (!reservation || reservation.sourceAudioPath !== path || reservation.expiresAt < until ||
        (reservation.verificationUntil && reservation.verificationUntil > now)) {
      throw new BilingualOpeningStoreError('CONFLICT');
    }
    const verificationId = randomUUID();
    const rows = await tx.$queryRaw<{ sessionId: string }[]>`
      UPDATE public.roleplay_bilingual_opening_reservations
      SET verification_id = ${verificationId}::uuid, verification_until = ${until}
      WHERE session_id = ${sessionId} AND source_audio_path = ${path}
        AND expires_at >= ${until} AND (verification_until IS NULL OR verification_until <= ${now})
      RETURNING session_id AS "sessionId"
    `;
    if (rows.length !== 1 || rows[0].sessionId !== sessionId) throw new BilingualOpeningStoreError('CONFLICT');
    return { kind: 'claimed', verificationId };
  });
}

/** Only the current verifier can commit measured evidence; no stale lease can publish. */
export async function completeBilingualOpeningVerification(
  db: Store, sessionId: string, actor: BilingualOpeningActor, verificationId: string,
  evidence: { sourceAudioPath: string; durationSec: number },
): Promise<'created' | 'replayed'> {
  if (getBilingualOpeningState(sessionId, true, { ...evidence, confirmedAt: new Date() }) !== 'confirmed') {
    throw new BilingualOpeningStoreError('INVALID_EVIDENCE');
  }
  return openingTransaction(db, async tx => {
    const session = await lockAuthorizedSession(tx, sessionId, actor);
    if (!session.required) throw new BilingualOpeningStoreError('FORBIDDEN');
    const existing = await readOpening(tx, sessionId);
    if (existing) {
      if (getBilingualOpeningState(sessionId, true, existing) === 'confirmed' &&
          existing.sourceAudioPath === evidence.sourceAudioPath && existing.durationSec === evidence.durationSec) return 'replayed';
      throw new BilingualOpeningStoreError('CONFLICT');
    }
    const reservation = await readReservation(tx, sessionId);
    const now = new Date();
    if (session.currentIndex !== 0 || !reservation || reservation.sourceAudioPath !== evidence.sourceAudioPath ||
        reservation.verificationId !== verificationId || !reservation.verificationUntil ||
        reservation.verificationUntil <= now || reservation.expiresAt <= now) {
      throw new BilingualOpeningStoreError('CONFLICT');
    }
    const rows = await tx.$queryRaw<{ sessionId: string }[]>`
      INSERT INTO public.roleplay_bilingual_openings (session_id, source_audio_path, duration_sec, confirmed_at)
      VALUES (${sessionId}, ${evidence.sourceAudioPath}, ${evidence.durationSec}, ${now})
      ON CONFLICT (session_id) DO NOTHING RETURNING session_id AS "sessionId"
    `;
    if (rows.length !== 1 || rows[0].sessionId !== sessionId) throw new BilingualOpeningStoreError('CONFLICT');
    return 'created';
  });
}

/** Authorized recovery details; never return a signed token or a verifier ID. */
export async function readBilingualOpeningRecovery(db: Store, sessionId: string, actor: BilingualOpeningActor) {
  return openingTransaction(db, async tx => {
    const session = await lockAuthorizedSession(tx, sessionId, actor);
    if (!session.required) return { state: 'not-required' as const };
    const state = getBilingualOpeningState(sessionId, true, await readOpening(tx, sessionId));
    if (state !== 'pending') return { state };
    if (session.currentIndex !== 0) throw new BilingualOpeningStoreError('CONFLICT');
    const reservation = await readReservation(tx, sessionId);
    const now = Date.now();
    if (!reservation || reservation.expiresAt.getTime() <= now ||
        !isCanonicalBilingualOpeningPath(reservation.sourceAudioPath, sessionId)) return { state };
    return {
      state,
      reservation: {
        path: reservation.sourceAudioPath,
        expiresAt: reservation.expiresAt.toISOString(),
        retryAt: reservation.verificationUntil && reservation.verificationUntil.getTime() > now
          ? reservation.verificationUntil.toISOString() : null,
      },
    };
  });
}

/** Explicitly abandon only the caller's matching, unconfirmed reservation.
 * The DB trigger records retired paths; no live Storage deletion here.
 * An active verifier is never interrupted. A stale tab cannot discard a
 * different reservation created by another tab.
 */
export async function discardBilingualOpeningReservation(
  db: Store, sessionId: string, actor: BilingualOpeningActor, path: string,
): Promise<'pending'> {
  if (!isCanonicalBilingualOpeningPath(path, sessionId)) throw new BilingualOpeningStoreError('INVALID_EVIDENCE');
  return openingTransaction<'pending'>(db, async tx => {
    const session = await lockAuthorizedSession(tx, sessionId, actor);
    if (!session.required || session.currentIndex !== 0) throw new BilingualOpeningStoreError('FORBIDDEN');
    if (await readOpening(tx, sessionId)) throw new BilingualOpeningStoreError('CONFLICT');
    const reservation = await readReservation(tx, sessionId);
    if (!reservation) return 'pending';
    const now = new Date();
    if (reservation.sourceAudioPath !== path ||
        (reservation.verificationUntil && reservation.verificationUntil > now)) {
      throw new BilingualOpeningStoreError('CONFLICT');
    }
    const rows = await tx.$queryRaw<{ sessionId: string }[]>`
      DELETE FROM public.roleplay_bilingual_opening_reservations
      WHERE session_id = ${sessionId} AND source_audio_path = ${path}
        AND (verification_until IS NULL OR verification_until <= ${now})
      RETURNING session_id AS "sessionId"
    `;
    if (rows.length !== 1 || rows[0].sessionId !== sessionId) throw new BilingualOpeningStoreError('CONFLICT');
    return 'pending';
  });
}
