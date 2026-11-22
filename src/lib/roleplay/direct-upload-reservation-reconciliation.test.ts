// @vitest-environment node
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { prepareNewRoleplayUploadReservation } from './direct-upload-reservation';
import {
  fingerprintRoleplayDirectUploadDeclarations,
} from './direct-upload-reservation-fingerprint';
import {
  reconcileRoleplayDirectUploadReservation,
  RoleplayUploadReconciliationError,
} from './direct-upload-reservation-reconciliation';

const actor = 'synthetic-admin-A';
const anotherActor = 'synthetic-admin-B';
const requestKey = '123e4567-e89b-42d3-a456-426614174000';
const now = 1_800_000_000_000;
const declarations = [
  { order: 0, mime: 'audio/mpeg', sizeBytes: 5, sha256: 'a'.repeat(64) },
  { order: 1, mime: 'audio/wav', sizeBytes: 12, sha256: 'b'.repeat(64) },
];
const validFingerprint = fingerprintRoleplayDirectUploadDeclarations(
  prepareNewRoleplayUploadReservation(actor, declarations, now).reservation.items,
);

type StoredRow = {
  actorUserId: string;
  declarationHash: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
};

const record = (overrides: Partial<StoredRow> = {}): StoredRow => ({
  actorUserId: actor,
  declarationHash: validFingerprint,
  status: 'RESERVED',
  createdAt: new Date(now - 60_000),
  expiresAt: new Date(now + 20 * 60_000),
  ...overrides,
});

function store(row: StoredRow | null = record()) {
  const findUnique = vi.fn().mockResolvedValue(row);
  const create = vi.fn();
  const update = vi.fn();
  const deleteMany = vi.fn();
  return {
    findUnique, create, update, deleteMany,
    db: { roleplayUploadReservation: { findUnique, create, update, deleteMany } }
      as unknown as Pick<PrismaClient, 'roleplayUploadReservation'>,
  };
}

const reconcile = (db: Pick<PrismaClient, 'roleplayUploadReservation'>,
  owner = actor, input: unknown = declarations, key = requestKey, clock = now) =>
  reconcileRoleplayDirectUploadReservation(db, owner, key, input, clock);

describe('future read-only Roleplay upload reservation reconciliation (unwired)', () => {
  it('uses owner+request key and selects no files, evidence or upload capability', async () => {
    const s = store();
    expect(await reconcile(s.db)).toEqual({ decision: 'INSPECT_STORAGE' });
    expect(s.findUnique).toHaveBeenCalledOnce();
    expect(s.findUnique).toHaveBeenCalledWith({
      where: { actorUserId_requestKey: { actorUserId: actor, requestKey } },
      select: {
        actorUserId: true, declarationHash: true, status: true,
        createdAt: true, expiresAt: true,
      },
    });
    expect(s.create).not.toHaveBeenCalled();
    expect(s.update).not.toHaveBeenCalled();
    expect(s.deleteMany).not.toHaveBeenCalled();
  });

  it('requires trusted verification for every pending state, never a new upload token', async () => {
    const expected = {
      RESERVED: 'INSPECT_STORAGE',
      VERIFYING: 'INSPECT_STORAGE',
      VERIFIED: 'VERIFY_SERVER_EVIDENCE',
      PUBLISHED: 'PUBLISHED_REQUIRES_CONFIRMATION',
      CANCELLED: 'CLOSED',
    } as const;
    for (const [status, decision] of Object.entries(expected)) {
      const s = store(record({ status }));
      const result = await reconcile(s.db);
      expect(result).toEqual({ decision });
      expect(JSON.stringify(result)).not.toContain('staging/');
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
      expect(s.findUnique).toHaveBeenCalledOnce();
    }
  });

  it('handles expiry conservatively but still reports terminal rows for review', async () => {
    const expiry = new Date(now - 1);
    const created = new Date(now - 20 * 60_000);
    for (const status of ['RESERVED', 'VERIFYING', 'VERIFIED']) {
      const s = store(record({ status, createdAt: created, expiresAt: expiry }));
      expect(await reconcile(s.db)).toEqual({ decision: 'EXPIRED' });
    }
    expect(await reconcile(store(record({
      status: 'PUBLISHED', createdAt: created, expiresAt: expiry,
    })).db)).toEqual({ decision: 'PUBLISHED_REQUIRES_CONFIRMATION' });
    expect(await reconcile(store(record({
      status: 'CANCELLED', createdAt: created, expiresAt: expiry,
    })).db)).toEqual({ decision: 'CLOSED' });
  });

  it('does not infer success from unknown, invalid or future database records', async () => {
    for (const invalid of [
      { status: 'OTHER' },
      { createdAt: new Date(now + 1) },
      { createdAt: new Date(0) },
      { createdAt: new Date('bad') },
      { expiresAt: new Date(now - 80_000) },
      { expiresAt: new Date(now + 60 * 60_000) },
    ]) {
      const result = await reconcile(store(record(invalid)).db);
      expect(result).toEqual({ decision: 'REVIEW_REQUIRED' });
    }
  });

  it('does not leak or read a different administrator reservation', async () => {
    const s = store(record({ actorUserId: anotherActor }));
    expect(await reconcile(s.db)).toEqual({ decision: 'CONFLICT' });
    expect(s.findUnique.mock.calls[0][0].where.actorUserId_requestKey.actorUserId)
      .toBe(actor);
    const independent = store(record({ actorUserId: anotherActor }));
    expect(await reconcile(independent.db, anotherActor)).toEqual({
      decision: 'INSPECT_STORAGE',
    });
    expect(independent.findUnique.mock.calls[0][0].where.actorUserId_requestKey.actorUserId)
      .toBe(anotherActor);
  });

  it('distinguishes a missing prior row without authorizing creation or retry', async () => {
    const s = store(null);
    expect(await reconcile(s.db)).toEqual({ decision: 'NOT_FOUND' });
    expect(s.create).not.toHaveBeenCalled();
    expect(s.update).not.toHaveBeenCalled();
  });

  it('rejects reusing a request key with a changed declaration fingerprint', async () => {
    const s = store();
    const mutated = declarations.map((value, index) => index === 0
      ? { ...value, sha256: 'c'.repeat(64) } : value);
    expect(await reconcile(s.db, actor, mutated)).toEqual({ decision: 'CONFLICT' });
  });

  it('rejects invalid callers and forbidden metadata before querying persistence', async () => {
    const s = store();
    const examples: Array<[string, unknown, string, number]> = [
      ['', declarations, requestKey, now],
      [actor, [], requestKey, now],
      [actor, declarations, 'not-uuid', now],
      [actor, [{ ...declarations[0], fileName: 'PRIVATE_RECORDING.mp3' }], requestKey, now],
      [actor, declarations, requestKey, -1],
    ];
    for (const [owner, input, key, clock] of examples) {
      await expect(reconcile(s.db, owner, input, key, clock))
        .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    expect(s.findUnique).not.toHaveBeenCalled();
  });

  it('redacts provider exceptions and never mutates storage', async () => {
    const s = store();
    s.findUnique.mockRejectedValue(new Error('SECRET_PG_URI_AND_PATIENT_PATH'));
    let caught: unknown;
    try { await reconcile(s.db); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(RoleplayUploadReconciliationError);
    expect(caught).toMatchObject({ code: 'STORE_UNAVAILABLE' });
    expect(String(caught)).not.toContain('SECRET_PG_URI_AND_PATIENT_PATH');
    expect(s.update).not.toHaveBeenCalled();
    expect(s.create).not.toHaveBeenCalled();
    expect(s.deleteMany).not.toHaveBeenCalled();
  });

  it('uses the exact original claim fingerprint without batch IDs or timestamps', () => {
    const otherSnapshot = prepareNewRoleplayUploadReservation(anotherActor, declarations, now + 1);
    expect(fingerprintRoleplayDirectUploadDeclarations(otherSnapshot.reservation.items))
      .toBe(validFingerprint);
    expect(validFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
});
