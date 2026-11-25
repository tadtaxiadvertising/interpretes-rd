import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { confirmVerifiedBilingualOpening, readBilingualOpeningState, reserveBilingualOpeningPath, claimBilingualOpeningVerification, completeBilingualOpeningVerification, discardBilingualOpeningReservation } from './bilingual-opening-store';

vi.mock('server-only', () => ({}));

const id = 'session-1';
const actor = { role: 'candidate', candidateId: 5, sessionCookie: id } as const;
const session = { id, required: true, status: 'STARTED', currentIndex: 0, candidateId: 5, interpreterId: 7 };
const access = { validatedAt: new Date(), usedAt: null, expiresAt: new Date(Date.now() + 3600000) };
const evidence = { sourceAudioPath: 'openings/session-1/123e4567-e89b-42d3-a456-426614174000.webm', durationSec: 42 };
const existing = { ...evidence, confirmedAt: new Date() };

function fixture(...rows: unknown[][]) {
  const query = vi.fn();
  for (const row of rows) query.mockResolvedValueOnce(row);
  const db = { $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({ $queryRaw: query })) };
  return { db: db as unknown as Pick<PrismaClient, '$transaction'>, query };
}

describe('staged bilingual opening persistence', () => {
  it('creates independent evidence in a locked, authorized session', async () => {
    const { db, query } = fixture([session], [access], [], [{ sessionId: id }]);
    await expect(confirmVerifiedBilingualOpening(db, id, actor, evidence)).resolves.toBe('created');
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[0][0].join('')).toContain('FOR UPDATE');
    expect(query.mock.calls[3][0].join('')).toContain('ON CONFLICT (session_id) DO NOTHING');
    expect(query.mock.calls[3].slice(1, 4)).toEqual([id, evidence.sourceAudioPath, 42]);
  });

  it('recovers a confirmed opening and replays the same evidence without another write', async () => {
    const first = fixture([session], [access], [existing]);
    await expect(readBilingualOpeningState(first.db, id, actor)).resolves.toBe('confirmed');
    const retry = fixture([{ ...session, currentIndex: 1 }], [access], [existing]);
    await expect(confirmVerifiedBilingualOpening(retry.db, id, actor, evidence)).resolves.toBe('replayed');
    expect(retry.query).toHaveBeenCalledTimes(3);
  });

  it('rejects different evidence and a late first confirmation', async () => {
    const conflict = fixture([session], [access], [{ ...existing, durationSec: 43 }]);
    await expect(confirmVerifiedBilingualOpening(conflict.db, id, actor, evidence)).rejects.toMatchObject({ code: 'CONFLICT' });
    const late = fixture([{ ...session, currentIndex: 1 }], [access], []);
    await expect(confirmVerifiedBilingualOpening(late.db, id, actor, evidence)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(late.query).toHaveBeenCalledTimes(3);
  });

  it('rejects other owners, revoked sessions and expired or consumed invitations', async () => {
    for (const unauthorized of [
      { ...actor, candidateId: 6 }, { ...actor, sessionCookie: null },
      { role: 'interpreter', interpreterId: 7 } as const,
    ]) {
      const { db, query } = fixture([session]);
      await expect(confirmVerifiedBilingualOpening(db, id, unauthorized, evidence)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(query).toHaveBeenCalledTimes(1);
    }
    for (const invalidAccess of [{ ...access, usedAt: new Date() }, { ...access, expiresAt: new Date(0) }, { ...access, validatedAt: null }]) {
      const { db, query } = fixture([session], [invalidAccess]);
      await expect(confirmVerifiedBilingualOpening(db, id, actor, evidence)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(query).toHaveBeenCalledTimes(2);
    }
    const revoked = fixture([{ ...session, status: 'CANCELLED' }]);
    await expect(readBilingualOpeningState(revoked.db, id, actor)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('keeps exempt sessions untouched and fails closed when schema is unavailable', async () => {
    const legacy = fixture([{ ...session, required: false }], [access]);
    await expect(readBilingualOpeningState(legacy.db, id, actor)).resolves.toBe('not-required');
    expect(legacy.query).toHaveBeenCalledTimes(2);
    const unavailable = fixture();
    unavailable.query.mockRejectedValueOnce(new Error('private database details'));
    await expect(readBilingualOpeningState(unavailable.db, id, actor)).rejects.toMatchObject({ code: 'STORE_UNAVAILABLE', message: 'STORE_UNAVAILABLE' });
    const invalid = fixture();
    await expect(confirmVerifiedBilingualOpening(invalid.db, id, actor, { ...evidence, durationSec: 0 })).rejects.toMatchObject({ code: 'INVALID_EVIDENCE' });
    expect(invalid.query).not.toHaveBeenCalled();
  });

  it('authorizes the interpreter owner of a non-recruitment session', async () => {
    const { db } = fixture([{ ...session, candidateId: null }], []);
    await expect(readBilingualOpeningState(db, id, { role: 'interpreter', interpreterId: 7 })).resolves.toBe('pending');
  });
});

describe('opening reservation fencing', () => {
  const reservation = () => ({
    sourceAudioPath: evidence.sourceAudioPath, expiresAt: new Date(Date.now() + 600_000),
    verificationId: null, verificationUntil: null,
  });
  it('reserves before verification and rejects a second live reservation', async () => {
    const first = fixture([session], [access], [], [], [{ sessionId: id }]);
    await expect(reserveBilingualOpeningPath(first.db, id, actor, evidence.sourceAudioPath)).resolves.toBeUndefined();
    const second = fixture([session], [access], [], [reservation()]);
    await expect(reserveBilingualOpeningPath(second.db, id, actor, evidence.sourceAudioPath)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(second.query).toHaveBeenCalledTimes(4);
  });
  it('claims only the currently reserved path and rejects concurrent verification', async () => {
    const first = fixture([session], [access], [], [reservation()], [{ sessionId: id }]);
    await expect(claimBilingualOpeningVerification(first.db, id, actor, evidence.sourceAudioPath)).resolves.toMatchObject({ kind: 'claimed', verificationId: expect.any(String) });
    const concurrent = fixture([session], [access], [], [{ ...reservation(), verificationUntil: new Date(Date.now() + 60_000) }]);
    await expect(claimBilingualOpeningVerification(concurrent.db, id, actor, evidence.sourceAudioPath)).rejects.toMatchObject({ code: 'CONFLICT' });
    const foreign = fixture([session], [access], [], [{ ...reservation(), sourceAudioPath: evidence.sourceAudioPath.replace('.webm', '.ogg') }]);
    await expect(claimBilingualOpeningVerification(foreign.db, id, actor, evidence.sourceAudioPath)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('rejects stale verifier evidence and allows only the current lease to publish', async () => {
    const lease = { ...reservation(), verificationId: 'current-lease', verificationUntil: new Date(Date.now() + 60_000) };
    const stale = fixture([session], [access], [], [lease]);
    await expect(completeBilingualOpeningVerification(stale.db, id, actor, 'stale-lease', evidence)).rejects.toMatchObject({ code: 'CONFLICT' });
    const expired = fixture([session], [access], [], [{ ...lease, verificationUntil: new Date(0) }]);
    await expect(completeBilingualOpeningVerification(expired.db, id, actor, 'current-lease', evidence)).rejects.toMatchObject({ code: 'CONFLICT' });
    const current = fixture([session], [access], [], [lease], [{ sessionId: id }]);
    await expect(completeBilingualOpeningVerification(current.db, id, actor, 'current-lease', evidence)).resolves.toBe('created');
  });
});

describe('discard pending opening', () => {
  const path = evidence.sourceAudioPath;
  const reservation = { sourceAudioPath: path, expiresAt: new Date(Date.now()+600_000), verificationId: null, verificationUntil: null };
  it('removes only a matching pending reservation under the session lock', async () => {
    const { db, query } = fixture([session], [access], [], [reservation], [{ sessionId: id }]);
    await expect(discardBilingualOpeningReservation(db, id, actor, path)).resolves.toBe('pending');
    expect(query.mock.calls[4][0].join('')).toContain('DELETE FROM public.roleplay_bilingual_opening_reservations');
    expect(query.mock.calls[4].slice(1, 3)).toEqual([id, path]);
  });
  it('preserves confirmed evidence, active verification and another tab’s reservation', async () => {
    const confirmed = fixture([session], [access], [existing]);
    await expect(discardBilingualOpeningReservation(confirmed.db, id, actor, path)).rejects.toMatchObject({ code: 'CONFLICT' });
    for (const row of [{ ...reservation, verificationUntil: new Date(Date.now()+60_000) }, { ...reservation, sourceAudioPath: path.replace('.webm','.ogg') }]) {
      const { db, query } = fixture([session], [access], [], [row]);
      await expect(discardBilingualOpeningReservation(db, id, actor, path)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(query).toHaveBeenCalledTimes(4);
    }
  });
  it('supports an idempotent retry and rejects cross-session paths', async () => {
    const { db, query } = fixture([session], [access], [], []);
    await expect(discardBilingualOpeningReservation(db, id, actor, path)).resolves.toBe('pending');
    await expect(discardBilingualOpeningReservation(db, id, actor, path.replace(id,'foreign'))).rejects.toMatchObject({ code: 'INVALID_EVIDENCE' });
    expect(query).toHaveBeenCalledTimes(4);
  });
});
