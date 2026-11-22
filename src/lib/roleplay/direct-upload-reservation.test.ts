// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  prepareNewRoleplayUploadReservation,
  ROLEPLAY_UPLOAD_RESERVATION_TTL_MS,
  RoleplayReservationPreparationError,
} from './direct-upload-reservation';
import { ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES } from './direct-upload-contract';
import {
  validateRoleplayDirectUploadPublication,
  type TrustedRoleplayUploadEvidence,
} from './direct-upload-publication-gate';

const now = 1_800_000_000_000;
const owner = 'synthetic-admin-A';
const hash = 'a'.repeat(64);
const files = (count: number) => Array.from({ length: count }, (_, order) => ({
  order, mime: 'audio/mpeg', sizeBytes: ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES, sha256: hash,
}));

describe('future server-only Roleplay reservation preparation (no DB or Storage calls)', () => {
  it('generates a canonical server UUID, owner, 30-minute expiry and 25 slots', () => {
    const result = prepareNewRoleplayUploadReservation(owner, files(25), now);
    const { reservation } = result;
    expect(reservation.batchId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(reservation).toMatchObject({
      ownerUserId: owner,
      status: 'RESERVED',
      createdAtMs: now,
      expiresAtMs: now + ROLEPLAY_UPLOAD_RESERVATION_TTL_MS,
    });
    expect(result.totalBytes).toBe(25 * ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES);
    expect(reservation.items).toHaveLength(25);
    expect(reservation.items[0].path).toBe('staging/roleplay/' + reservation.batchId + '/0.mp3');
    expect(reservation.items[24].path).toBe('staging/roleplay/' + reservation.batchId + '/24.mp3');
    expect(reservation.items.every(item => item.sha256 === hash)).toBe(true);
  });

  it('creates a new non-reusable batch ID for a subsequent valid request', () => {
    const first = prepareNewRoleplayUploadReservation(owner, files(1), now);
    const second = prepareNewRoleplayUploadReservation(owner, files(1), now);
    expect(first.reservation.batchId).not.toBe(second.reservation.batchId);
    expect(first.reservation.items[0].path).not.toBe(second.reservation.items[0].path);
  });

  it('fails closed before creation for an unauthenticated or malformed actor', () => {
    for (const actor of ['', '  ', 'x'.repeat(257), 'user\nother', null, 8]) {
      expect(() => prepareNewRoleplayUploadReservation(
        actor as string, files(1), now,
      )).toThrow(RoleplayReservationPreparationError);
    }
  });

  it('rejects overflow and ambiguous timestamps', () => {
    for (const clock of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5,
      Number.MAX_SAFE_INTEGER]) {
      expect(() => prepareNewRoleplayUploadReservation(
        owner, files(1), clock,
      )).toThrow('INVALID_ROLEPLAY_UPLOAD_RESERVATION');
    }
  });

  it('rejects malformed and injected declarations without reflecting metadata', () => {
    const privateName = 'PRIVATE_PATIENT_RECORDING.mp3';
    const tests: unknown[] = [
      [], files(26), [{ ...files(1)[0], order: 1 }],
      [{ ...files(1)[0], fileName: privateName }],
      [{ ...files(1)[0], path: '../../private.mp3' }],
      [{ ...files(1)[0], signedUrl: 'https://invalid.example/private-token' }],
      [{ ...files(1)[0], sha256: 'not-hex' }],
      [{ ...files(1)[0], sizeBytes: ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES + 1 }],
      [{ ...files(1)[0], mime: 'application/octet-stream' }],
    ];
    for (const declarations of tests) {
      let caught: unknown;
      try {
        prepareNewRoleplayUploadReservation(owner, declarations, now);
      } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(RoleplayReservationPreparationError);
      expect(String(caught)).not.toContain(privateName);
      expect(String(caught)).not.toContain('private-token');
      expect(String(caught)).not.toContain(owner);
    }
  });

  it('requires trusted verification after reservation before future publication', () => {
    const { reservation } = prepareNewRoleplayUploadReservation(owner, files(1), now);
    const evidence: TrustedRoleplayUploadEvidence[] = reservation.items.map(item => ({
      order: item.order, path: item.path, sizeBytes: item.sizeBytes,
      sha256: item.sha256, verifiedAtMs: now + 1_000,
    }));
    expect(() => validateRoleplayDirectUploadPublication(
      reservation, evidence, owner, now + 2_000,
    )).toThrow('NOT_VERIFIED');
    expect(validateRoleplayDirectUploadPublication(
      { ...reservation, status: 'VERIFIED' }, evidence, owner, now + 2_000,
    ).totalBytes).toBe(ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES);
    expect(() => validateRoleplayDirectUploadPublication(
      { ...reservation, status: 'VERIFIED' }, evidence, 'synthetic-admin-B', now + 2_000,
    )).toThrow('NOT_OWNER');
  });
});
