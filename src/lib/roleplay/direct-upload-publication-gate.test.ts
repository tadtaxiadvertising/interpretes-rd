// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  validateRoleplayDirectUploadPublication,
  RoleplayPublicationBlockedError,
  type RoleplayUploadReservationSnapshot,
  type TrustedRoleplayUploadEvidence,
} from './direct-upload-publication-gate';
import {
  prepareRoleplayDirectUploadBatch,
  ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES,
} from './direct-upload-contract';

const batchId = '123e4567-e89b-42d3-a456-426614174000';
const now = 1_800_000_000_000;
const digest = 'a'.repeat(64);
const ownerId = 'synthetic-admin-A';

function createFixtures(count = 3, sizeBytes = 12) {
  const prepared = prepareRoleplayDirectUploadBatch(
    batchId,
    Array.from({ length: count }, (_, order) => ({
      order, mime: 'audio/mpeg', sizeBytes, sha256: digest,
    })),
  );
  const reservation: RoleplayUploadReservationSnapshot = {
    batchId, ownerUserId: ownerId, status: 'VERIFIED',
    createdAtMs: now - 10_000, expiresAtMs: now + 60_000,
    items: prepared.items,
  };
  const evidence: TrustedRoleplayUploadEvidence[] = prepared.items.map(item => ({
    order: item.order, path: item.path, sizeBytes: item.sizeBytes,
    sha256: item.sha256, verifiedAtMs: now - 1_000,
  }));
  return { reservation, evidence };
}

describe('future Roleplay direct-upload publication gate (no Storage or DB writes)', () => {
  it('accepts a complete 25-clip verified batch with canonical paths and totals', () => {
    const { reservation, evidence } = createFixtures(25, ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES);
    const result = validateRoleplayDirectUploadPublication(reservation, evidence, ownerId, now);
    expect(result.items).toHaveLength(25);
    expect(result.totalBytes).toBe(25 * ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES);
    expect(result.items[0].path).toBe('staging/roleplay/' + batchId + '/0.mp3');
    expect(result.items[24].path).toBe('staging/roleplay/' + batchId + '/24.mp3');
    expect(result.items).not.toBe(reservation.items);
  });

  it('accepts a single verified audio without requiring 25 slots', () => {
    const { reservation, evidence } = createFixtures(1);
    expect(validateRoleplayDirectUploadPublication(reservation, evidence, ownerId, now).totalBytes)
      .toBe(12);
  });

  it('rejects an administrator other than the reservation owner', () => {
    const { reservation, evidence } = createFixtures();
    expect(() => validateRoleplayDirectUploadPublication(
      reservation, evidence, 'synthetic-admin-B', now,
    )).toThrowError(RoleplayPublicationBlockedError);
    expect(() => validateRoleplayDirectUploadPublication(
      reservation, evidence, 'synthetic-admin-B', now,
    )).toThrow('NOT_OWNER');
    expect(() => validateRoleplayDirectUploadPublication(
      reservation, evidence, '', now,
    )).toThrow('INVALID_RESERVATION');
  });

  it('rejects a batch exactly at expiration, afterward, or with an invalid clock', () => {
    const { reservation, evidence } = createFixtures();
    expect(() => validateRoleplayDirectUploadPublication(
      reservation, evidence, ownerId, reservation.expiresAtMs,
    )).toThrow('EXPIRED');
    expect(() => validateRoleplayDirectUploadPublication(
      reservation, evidence, ownerId, now + 100_000,
    )).toThrow('EXPIRED');
    expect(() => validateRoleplayDirectUploadPublication(
      reservation, evidence, ownerId, Number.NaN,
    )).toThrow('INVALID_RESERVATION');
  });

  it('rejects stale evidence from before reservation creation', () => {
    const { reservation, evidence } = createFixtures();
    for (const invalidTime of [1, reservation.createdAtMs - 1]) {
      const changed = [{ ...evidence[0], verifiedAtMs: invalidTime }, ...evidence.slice(1)];
      expect(() => validateRoleplayDirectUploadPublication(
        reservation, changed, ownerId, now,
      )).toThrow('EVIDENCE_MISMATCH');
    }
    const atCreation = [{ ...evidence[0], verifiedAtMs: reservation.createdAtMs },
      ...evidence.slice(1)];
    expect(() => validateRoleplayDirectUploadPublication(
      reservation, atCreation, ownerId, now,
    )).not.toThrow();
  });

  it('rejects missing, future, or inverted server reservation timestamps', () => {
    const { reservation, evidence } = createFixtures();
    for (const times of [
      { createdAtMs: 0 },
      { createdAtMs: Number.NaN },
      { createdAtMs: now + 1 },
      { expiresAtMs: reservation.createdAtMs },
      { expiresAtMs: reservation.createdAtMs - 1 },
    ]) {
      expect(() => validateRoleplayDirectUploadPublication(
        { ...reservation, ...times }, evidence, ownerId, now,
      )).toThrow('INVALID_RESERVATION');
    }
  });

  it('rejects reserved, verifying, cancelled or already published batches', () => {
    const { reservation, evidence } = createFixtures();
    for (const status of ['RESERVED', 'VERIFYING', 'CANCELLED', 'PUBLISHED'] as const) {
      expect(() => validateRoleplayDirectUploadPublication(
        { ...reservation, status }, evidence, ownerId, now,
      )).toThrow('NOT_VERIFIED');
    }
  });

  it('rejects incomplete, excess, duplicate or reordered verification evidence', () => {
    const { reservation, evidence } = createFixtures(3);
    for (const snapshots of [
      evidence.slice(0, 2),
      [...evidence, evidence[2]],
      [evidence[0], evidence[0], evidence[2]],
      [evidence[2], evidence[1], evidence[0]],
    ]) {
      expect(() => validateRoleplayDirectUploadPublication(
        reservation, snapshots, ownerId, now,
      )).toThrow('EVIDENCE_MISMATCH');
    }
  });

  it('rejects paths from other batches, object spoofing and tampered digests', () => {
    const { reservation, evidence } = createFixtures();
    const invalid = [
      { ...evidence[0], path: 'staging/roleplay/another-batch/0.mp3' },
      { ...evidence[0], path: '../../private-recordings/0.mp3' },
      { ...evidence[0], sha256: 'b'.repeat(64) },
      { ...evidence[0], sizeBytes: 11 },
      { ...evidence[0], signedUrl: 'https://storage.invalid/token=SECRET' },
      { ...evidence[0], verifiedAtMs: now + 1 },
      { ...evidence[0], verifiedAtMs: 0 },
      { ...evidence[0], verifiedAtMs: reservation.expiresAtMs },
    ];
    for (const tampered of invalid) {
      expect(() => validateRoleplayDirectUploadPublication(
        reservation, [tampered, ...evidence.slice(1)], ownerId, now,
      )).toThrow('EVIDENCE_MISMATCH');
    }
  });

  it('rejects corrupted reservation paths and manifest ordering', () => {
    const { reservation, evidence } = createFixtures();
    expect(() => validateRoleplayDirectUploadPublication(
      { ...reservation, items: [{ ...reservation.items[0], path: 'outside/0.mp3' }, ...reservation.items.slice(1)] },
      evidence, ownerId, now,
    )).toThrow('INVALID_RESERVATION');
    expect(() => validateRoleplayDirectUploadPublication(
      { ...reservation, items: [reservation.items[1], reservation.items[0], reservation.items[2]] },
      evidence, ownerId, now,
    )).toThrow('INVALID_RESERVATION');
    expect(() => validateRoleplayDirectUploadPublication(
      { ...reservation, batchId: '../../outside' },
      evidence, ownerId, now,
    )).toThrow('INVALID_RESERVATION');
  });

  it('never echoes private fields in errors', () => {
    const { reservation, evidence } = createFixtures();
    const privatePath = 'staging/private/FAKE_SENSITIVE_FILENAME.mp3';
    let thrown: unknown;
    try {
      validateRoleplayDirectUploadPublication(
        reservation, [{ ...evidence[0], path: privatePath }, ...evidence.slice(1)],
        ownerId, now,
      );
    } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(RoleplayPublicationBlockedError);
    expect(String(thrown)).not.toContain('FAKE_SENSITIVE_FILENAME');
    expect(String(thrown)).not.toContain(ownerId);
  });
});
