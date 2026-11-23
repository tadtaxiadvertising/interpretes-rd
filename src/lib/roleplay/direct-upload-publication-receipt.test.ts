// @vitest-environment node
import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { prepareNewRoleplayUploadReservation } from './direct-upload-reservation';
import {
  fingerprintRoleplayDirectUploadDeclarations,
} from './direct-upload-reservation-fingerprint';
import { completeRoleplayUploadPublicationInTransaction } from './direct-upload-publication-receipt';
import type { TrustedRoleplayUploadEvidence } from './direct-upload-publication-gate';

const actor = 'ci-synthetic-admin-A';
const requestKey = '123e4567-e89b-42d3-a456-426614174000';
const now = 1_800_000_000_000;
const declarations = [
  { order: 0, mime: 'audio/mpeg', sizeBytes: 3, sha256: 'a'.repeat(64) },
  { order: 1, mime: 'audio/wav', sizeBytes: 4, sha256: 'b'.repeat(64) },
];

function fixture() {
  const reservation = prepareNewRoleplayUploadReservation(
    actor, declarations, now - 60_000,
  ).reservation;
  reservation.status = 'VERIFIED';
  const verifiedObjects: TrustedRoleplayUploadEvidence[] = reservation.items.map(item => ({
    order: item.order,
    path: item.path,
    sizeBytes: item.sizeBytes,
    sha256: item.sha256,
    verifiedAtMs: now - 10_000,
  }));
  return {
    actorUserId: actor,
    requestKey,
    reservation,
    verifiedObjects,
    sessionIds: ['session-one', 'session-two'],
    nowMs: now,
  };
}

function store(count = 1) {
  const updateMany = vi.fn().mockResolvedValue({ count });
  const tx = { roleplayUploadReservation: { updateMany } } as unknown as
    Pick<Prisma.TransactionClient, 'roleplayUploadReservation'>;
  return { tx, updateMany };
}

describe('future Roleplay publication receipt step (transaction caller only, unwired)', () => {
  it('records all session IDs in one owner-scoped conditional update', async () => {
    const s = store();
    const input = fixture();
    await completeRoleplayUploadPublicationInTransaction(s.tx, input);
    expect(s.updateMany).toHaveBeenCalledOnce();
    expect(s.updateMany).toHaveBeenCalledWith({
      where: {
        id: input.reservation.batchId,
        actorUserId: actor,
        requestKey,
        declarationHash: fingerprintRoleplayDirectUploadDeclarations(input.reservation.items),
        status: 'VERIFIED',
        createdAt: { lte: new Date(now) },
        expiresAt: { gt: new Date(now) },
      },
      data: { status: 'PUBLISHED', publishedSessionIds: ['session-one', 'session-two'] },
    });
    const payload = JSON.stringify(s.updateMany.mock.calls[0][0]);
    expect(payload).not.toContain('PRIVATE_PATIENT');
    expect(payload).not.toContain('verifiedObjects');
  });

  it('rejects incomplete, duplicate or untrusted session receipts before any update', async () => {
    const variants: Array<readonly string[]> = [
      [], ['session-one', 'session-one'], [''], ['../staging/private'],
      ['x'.repeat(121)],
      Array.from({ length: 1001 }, (_, i) => 'synthetic-session-' + i), ['valid-session', 'other\nroleplay'],
    ];
    for (const sessionIds of variants) {
      const s = store();
      await expect(completeRoleplayUploadPublicationInTransaction(
        s.tx, { ...fixture(), sessionIds },
      )).rejects.toMatchObject({ code: 'INVALID_RECEIPT' });
      expect(s.updateMany).not.toHaveBeenCalled();
    }
  });

  it('fails before write for wrong admin, unverified status or invalid evidence', async () => {
    const variants = [
      { ...fixture(), actorUserId: 'ci-synthetic-admin-B' },
      { ...fixture(), reservation: { ...fixture().reservation, status: 'RESERVED' as const } },
      { ...fixture(), verifiedObjects: [] },
      { ...fixture(), verifiedObjects: [
        { ...fixture().verifiedObjects[0], sha256: 'c'.repeat(64) },
        fixture().verifiedObjects[1],
      ] },
      { ...fixture(), nowMs: now + 31 * 60_000 },
      { ...fixture(), requestKey: 'not-uuid' },
    ];
    for (const input of variants) {
      const s = store();
      await expect(completeRoleplayUploadPublicationInTransaction(s.tx, input))
        .rejects.toMatchObject({ code: 'INVALID_RECEIPT' });
      expect(s.updateMany).not.toHaveBeenCalled();
    }
  });

  it('requires exactly one claimed transition and never claims a second publisher', async () => {
    for (const count of [0, 2]) {
      const s = store(count);
      await expect(completeRoleplayUploadPublicationInTransaction(s.tx, fixture()))
        .rejects.toMatchObject({ code: 'NOT_CLAIMED' });
      expect(s.updateMany).toHaveBeenCalledOnce();
    }
  });

  it('sanitizes provider exceptions without revealing session IDs or paths', async () => {
    const s = store();
    s.updateMany.mockRejectedValueOnce(new Error('PRIVATE_DATABASE_SECRET_AND_AUDIO_PATH'));
    let caught: unknown;
    try {
      await completeRoleplayUploadPublicationInTransaction(s.tx, fixture());
    } catch (error) { caught = error; }
    expect(caught).toMatchObject({ code: 'STORE_UNAVAILABLE' });
    expect(String(caught)).not.toContain('PRIVATE_DATABASE_SECRET_AND_AUDIO_PATH');
  });
});
