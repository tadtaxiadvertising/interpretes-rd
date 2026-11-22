// @vitest-environment node
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  claimRoleplayDirectUploadReservation,
  RoleplayUploadReservationLedgerError,
} from './direct-upload-reservation-ledger';

const actor = 'synthetic-admin-A';
const requestKey = '123e4567-e89b-42d3-a456-426614174000';
const sha = 'a'.repeat(64);
const now = 1_800_000_000_000;
const declarations = (count: number) => Array.from({ length: count }, (_, order) => ({
  order, mime: 'audio/mpeg', sizeBytes: 5, sha256: sha,
}));

function store(row: unknown = null, createError: unknown = null) {
  const create = vi.fn().mockResolvedValue({ id: 'synthetic-reservation' });
  if (createError) create.mockRejectedValue(createError);
  const findUnique = vi.fn().mockResolvedValue(row);
  const db = {
    roleplayUploadReservation: { create, findUnique },
  } as unknown as Pick<PrismaClient, 'roleplayUploadReservation'>;
  return { db, create, findUnique };
}

describe('future server-only Roleplay upload reservation idempotency (unwired)', () => {
  it('claims one authenticated 25-item batch and stores only canonical fields', async () => {
    const s = store();
    const claim = await claimRoleplayDirectUploadReservation(
      s.db, actor, requestKey, declarations(25), now,
    );
    expect(claim).toMatchObject({ kind: 'CREATED', batchId: expect.any(String) });
    if (claim.kind !== 'CREATED') throw new Error('expected synthetic claim');
    expect(s.create).toHaveBeenCalledOnce();
    const query = s.create.mock.calls[0][0];
    expect(query.select).toEqual({ id: true });
    expect(query.data).toMatchObject({
      id: claim.batchId,
      actorUserId: actor,
      requestKey,
      status: 'RESERVED',
      declarationHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      createdAt: new Date(now),
      expiresAt: new Date(now + 30 * 60 * 1000),
      verifiedObjects: [],
    });
    expect(query.data.items).toHaveLength(25);
    expect(query.data.items[0].path).toBe(
      'staging/roleplay/' + claim.batchId + '/0.mp3',
    );
    expect(s.findUnique).not.toHaveBeenCalled();
    expect(JSON.stringify(query)).not.toContain('PRIVATE_PATIENT');
  });

  it('returns reconciliation, not another upload, on unique retry with identical content', async () => {
    const first = store();
    await claimRoleplayDirectUploadReservation(first.db, actor, requestKey, declarations(1), now);
    const fingerprint = first.create.mock.calls[0][0].data.declarationHash;
    const duplicate = store({
      actorUserId: actor, declarationHash: fingerprint, status: 'RESERVED',
    }, { code: 'P2002' });
    const result = await claimRoleplayDirectUploadReservation(
      duplicate.db, actor, requestKey, declarations(1), now,
    );
    expect(result).toEqual({ kind: 'RECONCILE' });
    expect(duplicate.findUnique).toHaveBeenCalledWith({
      where: { actorUserId_requestKey: { actorUserId: actor, requestKey } },
      select: { actorUserId: true, declarationHash: true, status: true },
    });
  });

  it('never issues a duplicate capability for PUBLISHED, CANCELLED or expired retries', async () => {
    const first = store();
    await claimRoleplayDirectUploadReservation(first.db, actor, requestKey, declarations(1), now);
    const hash = first.create.mock.calls[0][0].data.declarationHash;
    for (const status of ['PUBLISHED', 'CANCELLED', 'VERIFYING', 'VERIFIED', 'UNKNOWN']) {
      const s = store({ actorUserId: actor, declarationHash: hash, status }, { code: 'P2002' });
      expect(await claimRoleplayDirectUploadReservation(
        s.db, actor, requestKey, declarations(1), now + 1_000_000,
      )).toEqual({ kind: 'RECONCILE' });
    }
  });

  it('rejects same actor/key with another clip digest, count or order', async () => {
    const original = store();
    await claimRoleplayDirectUploadReservation(original.db, actor, requestKey, declarations(2), now);
    const hash = original.create.mock.calls[0][0].data.declarationHash;
    const cases = [
      [{ ...declarations(1)[0], sha256: 'b'.repeat(64) }],
      declarations(1),
      [declarations(2)[1], declarations(2)[0]],
    ];
    for (const input of cases) {
      const s = store({ actorUserId: actor, declarationHash: hash, status: 'RESERVED' }, { code: 'P2002' });
      const output = await claimRoleplayDirectUploadReservation(
        s.db, actor, requestKey, input, now,
      ).catch(error => error);
      expect(
        output === undefined ? undefined :
          output instanceof RoleplayUploadReservationLedgerError
            ? output.code : (output as { kind: string }).kind,
      ).toBe(input.length === 2 ? 'INVALID_REQUEST' : 'CONFLICT');
    }
  });

  it('admits exactly one claim for two simultaneous identical requests', async () => {
    const rows = new Map<string, { actorUserId: string; declarationHash: string; status: string }>();
    const create = vi.fn(async ({ data }: { data: { actorUserId: string; requestKey: string; declarationHash: string } }) => {
      const scopedKey = data.actorUserId + ':' + data.requestKey;
      if (rows.has(scopedKey)) throw { code: 'P2002' };
      rows.set(scopedKey, {
        actorUserId: data.actorUserId,
        declarationHash: data.declarationHash,
        status: 'RESERVED',
      });
      return { id: 'synthetic-id' };
    });
    const findUnique = vi.fn(async ({ where }: { where: { actorUserId_requestKey: { actorUserId: string; requestKey: string } } }) => {
      const { actorUserId, requestKey: key } = where.actorUserId_requestKey;
      return rows.get(actorUserId + ':' + key) ?? null;
    });
    const db = { roleplayUploadReservation: { create, findUnique } }
      as unknown as Pick<PrismaClient, 'roleplayUploadReservation'>;

    const [first, second] = await Promise.all([
      claimRoleplayDirectUploadReservation(db, actor, requestKey, declarations(3), now),
      claimRoleplayDirectUploadReservation(db, actor, requestKey, declarations(3), now),
    ]);
    expect([first.kind, second.kind].sort()).toEqual(['CREATED', 'RECONCILE']);
    expect(rows.size).toBe(1);
    expect(create).toHaveBeenCalledTimes(2);
    expect(findUnique).toHaveBeenCalledOnce();
  });

  it('never treats another actor as the owner of a colliding row', async () => {
    const existing = store({ actorUserId: 'synthetic-admin-B', declarationHash: sha }, { code: 'P2002' });
    const result = await claimRoleplayDirectUploadReservation(
      existing.db, actor, requestKey, declarations(1), now,
    );
    expect(result).toEqual({ kind: 'CONFLICT' });
  });

  it('safely reconciles an ambiguous unique collision with no visible row', async () => {
    const s = store(null, { code: 'P2002' });
    expect(await claimRoleplayDirectUploadReservation(
      s.db, actor, requestKey, declarations(1), now,
    )).toEqual({ kind: 'RECONCILE' });
  });

  it('rejects missing, malformed and foreign request keys before a database write', async () => {
    const s = store();
    for (const key of ['', 'same-user-key', '../../other', requestKey.toUpperCase(),
      '00000000-0000-0000-0000-000000000000']) {
      await expect(claimRoleplayDirectUploadReservation(
        s.db, actor, key, declarations(1), now,
      )).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    expect(s.create).not.toHaveBeenCalled();
  });

  it('rejects untrusted declarations, missing owner and impossible clocks without DB writes', async () => {
    const s = store();
    for (const data of [[], declarations(26),
      [{ ...declarations(1)[0], signedUrl: 'https://private.invalid/SECRET' }]]) {
      await expect(claimRoleplayDirectUploadReservation(
        s.db, actor, requestKey, data, now,
      )).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    await expect(claimRoleplayDirectUploadReservation(
      s.db, '', requestKey, declarations(1), now,
    )).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(claimRoleplayDirectUploadReservation(
      s.db, actor, requestKey, declarations(1), Number.MAX_SAFE_INTEGER - 2_000_000,
    )).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(s.create).not.toHaveBeenCalled();
  });

  it('redacts database failures, never confusing outages with successful claims', async () => {
    const s = store(null, new Error('private://postgres/SECRET_DATABASE_PASSWORD'));
    let failure: unknown;
    try {
      await claimRoleplayDirectUploadReservation(s.db, actor, requestKey, declarations(1), now);
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(RoleplayUploadReservationLedgerError);
    expect(failure).toMatchObject({ code: 'STORE_UNAVAILABLE' });
    expect(String(failure)).not.toContain('SECRET_DATABASE_PASSWORD');
  });

  it('fails closed if reconciliation lookup loses database connectivity', async () => {
    const s = store(null, { code: 'P2002' });
    s.findUnique.mockRejectedValue(new Error('SECRET_SQL_DATABASE_URL'));
    await expect(claimRoleplayDirectUploadReservation(
      s.db, actor, requestKey, declarations(1), now,
    )).rejects.toMatchObject({ code: 'STORE_UNAVAILABLE' });
  });

  it('allows 2 admins to use the same request key only in independently owned rows', async () => {
    const a = store();
    const b = store();
    const [first, second] = await Promise.all([
      claimRoleplayDirectUploadReservation(a.db, actor, requestKey, declarations(1), now),
      claimRoleplayDirectUploadReservation(b.db, 'synthetic-admin-B', requestKey, declarations(1), now),
    ]);
    expect(first.kind).toBe('CREATED');
    expect(second.kind).toBe('CREATED');
    expect(a.create.mock.calls[0][0].data.actorUserId).toBe(actor);
    expect(b.create.mock.calls[0][0].data.actorUserId).toBe('synthetic-admin-B');
  });
});
