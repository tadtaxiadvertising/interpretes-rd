// @vitest-environment node
import type { Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  claimRoleplayCreation,
  completeRoleplayCreationInTransaction,
  fingerprintRoleplayCreation,
  InvalidRoleplayCreationKeyError,
  type RoleplayCreationFingerprintInput,
} from './creation-idempotency-ledger';

const actor = 'admin-synthetic-01';
const key = '123e4567-e89b-42d3-a456-426614174000';
const digest = 'a'.repeat(64);
const filenameSecret = 'PRIVATE_MEDICAL_PATIENT_FILE';
const scenario = { title: 'Consulta sintética', durationLimitSec: 120, scriptPrompt: '' };

function input(count = 1): RoleplayCreationFingerprintInput {
  return {
    participantType: 'interpreter', participantId: 12, libraryFingerprint: null,
    scenarios: Array.from({ length: count }, (_, i) => ({
      ...scenario, title: scenario.title + ' ' + i,
    })),
    audios: Array.from({ length: count }, () => ({
      mime: 'audio/mpeg', sizeBytes: 3, sha256: digest,
    })),
  };
}

function ledger(maybeRow: unknown = null, createError: unknown = null) {
  const create = vi.fn();
  if (createError) create.mockRejectedValue(createError);
  else create.mockResolvedValue({ id: 'id-1' });
  const findUnique = vi.fn().mockResolvedValue(maybeRow);
  const findMany = vi.fn().mockImplementation(async (query: { where: { id: { in: string[] } } }) =>
    query.where.id.in.map(id => ({ id })));
  const db = {
    roleplayCreationRequest: { create, findUnique },
    roleplaySession: { findMany },
  } as unknown as Pick<PrismaClient, 'roleplayCreationRequest' | 'roleplaySession'>;
  return { db, create, findUnique, findMany };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    actorUserId: actor, payloadHash: digest, status: 'IN_PROGRESS',
    sessionIds: [], createdCount: null, skippedCount: null,
    scenarioCount: null, completedAt: overrides.status === 'COMPLETED'
      ? new Date('2026-11-21T00:00:00.000Z') : null,
    ...overrides,
  };
}

describe('future Roleplay creation: content fingerprint without PII logging', () => {
  it('is stable for the same normalized 25-clip request', () => {
    const request = input(25);
    const first = fingerprintRoleplayCreation(request);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprintRoleplayCreation(structuredClone(request))).toBe(first);
    expect(first).not.toContain('Consulta');
  });

  it('changes with actor-target, clip order and actual content hash', () => {
    const base = input(2);
    const original = fingerprintRoleplayCreation(base);
    const changedTarget = { ...base, participantId: 13 };
    const changedBytes = { ...base, audios: [
      base.audios[0], { ...base.audios[1], sha256: 'b'.repeat(64) },
    ] };
    const changedOrder = { ...base, scenarios: [...base.scenarios].reverse() };
    expect(fingerprintRoleplayCreation(changedTarget)).not.toBe(original);
    expect(fingerprintRoleplayCreation(changedBytes)).not.toBe(original);
    expect(fingerprintRoleplayCreation(changedOrder)).not.toBe(original);
  });

  it('supports library reuse without reading audio bytes', () => {
    const request: RoleplayCreationFingerprintInput = {
      ...input(), libraryFingerprint: 'b'.repeat(64), audios: [],
    };
    expect(fingerprintRoleplayCreation(request)).toMatch(/^[a-f0-9]{64}$/);
    expect(() => fingerprintRoleplayCreation({
      ...request, audios: input().audios,
    })).toThrow(InvalidRoleplayCreationKeyError);
  });

  it('rejects malformed lengths, digests and unsupported audio', () => {
    const cases: RoleplayCreationFingerprintInput[] = [
      { ...input(), scenarios: [] },
      input(26),
      { ...input(), audios: [] },
      { ...input(), audios: [{ mime: 'audio/mpeg', sizeBytes: 0, sha256: digest }] },
      { ...input(), audios: [{ mime: 'audio/mpeg', sizeBytes: 15 * 1024 * 1024 + 1, sha256: digest }] },
      { ...input(), audios: [{ mime: 'text/html', sizeBytes: 3, sha256: digest }] },
      { ...input(), audios: [{ mime: 'audio/mpeg', sizeBytes: 3, sha256: 'not-sha' }] },
      { ...input(), participantId: 0 },
    ];
    for (const request of cases) {
      expect(() => fingerprintRoleplayCreation(request)).toThrow('INVALID_ROLEPLAY_CREATION_KEY');
    }
  });

  it('rejects non-finite numbers before JSON serialization can turn them into null', () => {
    const cases: RoleplayCreationFingerprintInput[] = [
      { ...input(), scenarios: [{ ...scenario, durationLimitSec: Number.NaN }] },
      { ...input(), scenarios: [{ ...scenario, durationLimitSec: Number.POSITIVE_INFINITY }] },
      { ...input(), scenarios: [{ ...scenario, durationLimitSec: 301 }] },
      { ...input(), scenarios: [{ ...scenario, studioTurn: Number.NaN }] },
      { ...input(), scenarios: [{ ...scenario, studioTurn: Number.POSITIVE_INFINITY }] },
      { ...input(), scenarios: [{ ...scenario, sourceStartSec: Number.NaN, sourceEndSec: 20 }] },
      { ...input(), scenarios: [{ ...scenario, sourceStartSec: 0, sourceEndSec: Number.NEGATIVE_INFINITY }] },
      { ...input(), scenarios: [{ ...scenario, sourceStartSec: 15, sourceEndSec: null }] },
      { ...input(), scenarios: [{ ...scenario, sourceStartSec: -1, sourceEndSec: 15 }] },
      { ...input(), scenarios: [{ ...scenario, sourceStartSec: 15, sourceEndSec: 15 }] },
    ];
    for (const request of cases) {
      expect(() => fingerprintRoleplayCreation(request)).toThrow(InvalidRoleplayCreationKeyError);
    }
  });

  it('preserves finite fractional clip times and a valid bounded duration', () => {
    const baseline = input();
    const valid: RoleplayCreationFingerprintInput = {
      ...baseline,
      scenarios: [{ ...scenario, durationLimitSec: 300, studioTurn: 10000,
        sourceStartSec: 0.125, sourceEndSec: 7200 }],
    };
    expect(fingerprintRoleplayCreation(valid)).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprintRoleplayCreation(valid)).not.toBe(fingerprintRoleplayCreation(baseline));
  });

  it('does not use original filenames in a request fingerprint', () => {
    const request = input();
    const withFileName = {
      ...request, audios: [{
        ...request.audios[0], name: filenameSecret,
      }],
    };
    expect(fingerprintRoleplayCreation(withFileName)).toBe(fingerprintRoleplayCreation(request));
  });
});

describe('durable Roleplay idempotency ledger: unique key claim', () => {
  it('creates a server-only IN_PROGRESS claim for one authenticated actor', async () => {
    const store = ledger();
    expect(await claimRoleplayCreation(store.db, actor, key, digest))
      .toEqual({ kind: 'CLAIMED' });
    expect(store.create).toHaveBeenCalledWith({
      data: { actorUserId: actor, requestKey: key, payloadHash: digest, status: 'IN_PROGRESS' },
      select: { id: true },
    });
    expect(store.findUnique).not.toHaveBeenCalled();
  });

  it('returns IN_PROGRESS on a second concurrent claim of identical content', async () => {
    const first = ledger();
    const second = ledger(row(), { code: 'P2002' });
    const [firstResult, duplicate] = await Promise.all([
      claimRoleplayCreation(first.db, actor, key, digest),
      claimRoleplayCreation(second.db, actor, key, digest),
    ]);
    expect(firstResult.kind).toBe('CLAIMED');
    expect(duplicate.kind).toBe('IN_PROGRESS');
    expect(second.findUnique).toHaveBeenCalledWith({
      where: { actorUserId_requestKey: { actorUserId: actor, requestKey: key } },
      select: expect.objectContaining({ payloadHash: true, status: true }),
    });
  });

  it('never replays a different fingerprint under the same key', async () => {
    const store = ledger(row(), { code: 'P2002' });
    expect(await claimRoleplayCreation(store.db, actor, key, 'b'.repeat(64)))
      .toEqual({ kind: 'CONFLICT' });
  });

  it('only replays complete, consistent result metadata from the same admin', async () => {
    const store = ledger(row({
      status: 'COMPLETED',
      sessionIds: ['roleplay-session-1', 'roleplay-session-2'],
      createdCount: 2, skippedCount: 1, scenarioCount: 25,
    }), { code: 'P2002' });
    expect(await claimRoleplayCreation(store.db, actor, key, digest)).toEqual({
      kind: 'REPLAY', sessionIds: ['roleplay-session-1', 'roleplay-session-2'],
      createdCount: 2, skippedCount: 1, scenarioCount: 25,
    });
    expect(store.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['roleplay-session-1', 'roleplay-session-2'] } },
      select: { id: true },
    });
  });

  it('never replays missing sessions from a completed claim', async () => {
    const store = ledger(row({
      status: 'COMPLETED', sessionIds: ['session-1', 'session-2'],
      createdCount: 2, skippedCount: 0, scenarioCount: 1,
    }), { code: 'P2002' });
    store.findMany.mockResolvedValueOnce([{ id: 'session-1' }]);
    expect(await claimRoleplayCreation(store.db, actor, key, digest))
      .toEqual({ kind: 'IN_PROGRESS' });
    expect(store.findMany).toHaveBeenCalledOnce();
  });

  it('fails closed when session verification is unavailable', async () => {
    const store = ledger(row({
      status: 'COMPLETED', sessionIds: ['session-1'],
      createdCount: 1, skippedCount: 0, scenarioCount: 1,
    }), { code: 'P2002' });
    store.findMany.mockRejectedValueOnce(new Error('SYNTHETIC_DB_UNAVAILABLE'));
    await expect(claimRoleplayCreation(store.db, actor, key, digest))
      .rejects.toThrow('SYNTHETIC_DB_UNAVAILABLE');
  });

  it('fails closed on corrupted or incomplete results, or mismatched actor', async () => {
    for (const existing of [
      row({ actorUserId: 'other-admin' }),
      row({ status: 'COMPLETED', createdCount: 2, skippedCount: 0, scenarioCount: 1, sessionIds: ['only-one'] }),
      row({ status: 'COMPLETED', createdCount: 2, skippedCount: 0, scenarioCount: 1, sessionIds: ['same-session', 'same-session'] }),
      row({ status: 'COMPLETED', completedAt: null, createdCount: 1, skippedCount: 0, scenarioCount: 1, sessionIds: ['only-one'] }),
      row({ status: 'COMPLETED', createdCount: 1, skippedCount: 0, scenarioCount: 0, sessionIds: ['one'] }),
      row({ status: 'FAILED', createdCount: 1, skippedCount: 0, scenarioCount: 1, sessionIds: ['one'] }),
    ]) {
      const store = ledger(existing, { code: 'P2002' });
      const result = await claimRoleplayCreation(store.db, actor, key, digest);
      expect(result.kind).not.toBe('REPLAY');
      expect(result.kind).not.toBe('CLAIMED');
    }
  });

  it('rejects invalid actor and request keys BEFORE any database access', async () => {
    const store = ledger();
    for (const candidate of ['', '../../../secret', key.toUpperCase(), '123e4567-e89b-12d3-a456-426614174000']) {
      await expect(claimRoleplayCreation(store.db, actor, candidate, digest))
        .rejects.toBeInstanceOf(InvalidRoleplayCreationKeyError);
    }
    await expect(claimRoleplayCreation(store.db, '', key, digest))
      .rejects.toBeInstanceOf(InvalidRoleplayCreationKeyError);
    await expect(claimRoleplayCreation(store.db, actor, key, 'not-a-hash'))
      .rejects.toBeInstanceOf(InvalidRoleplayCreationKeyError);
    expect(store.create).not.toHaveBeenCalled();
  });

  it('never mistakes schema-not-migrated or database errors for a duplicate', async () => {
    const store = ledger(null, { code: 'P2021', message: 'SYNTHETIC_POSTGRES_URL' });
    await expect(claimRoleplayCreation(store.db, actor, key, digest)).rejects
      .toMatchObject({ code: 'P2021' });
    expect(store.findUnique).not.toHaveBeenCalled();
  });

  it('never creates a second claim when a unique conflict cannot be reloaded', async () => {
    const store = ledger(null, { code: 'P2002' });
    expect(await claimRoleplayCreation(store.db, actor, key, digest))
      .toEqual({ kind: 'IN_PROGRESS' });
  });

  it('supports a content hash that cannot reveal raw payload by simple inspection', () => {
    const fingerprint = fingerprintRoleplayCreation({
      ...input(), scenarios: [{
        ...scenario, title: 'PRIVATE_HEALTH_CONTEXT_NOT_IN_LOG',
      }],
    });
    expect(fingerprint).toBe(createHash('sha256').update(
      JSON.stringify({
        version: 1, participantType: 'interpreter', participantId: 12,
        libraryFingerprint: null,
        scenarios: [{
          title: 'PRIVATE_HEALTH_CONTEXT_NOT_IN_LOG',
          durationLimitSec: 120, scriptPrompt: '',
          studioTurn: null, studioSpeaker: null, studioLanguage: null,
          sourceStartSec: null, sourceEndSec: null, expectedKeys: [],
        }],
        audios: [{ mime: 'audio/mpeg', sizeBytes: 3, sha256: digest }],
      }),
    ).digest('hex'));
    expect(fingerprint).not.toContain('PRIVATE_HEALTH_CONTEXT_NOT_IN_LOG');
  });
});


describe('Roleplay ledger: conditional completion in the publisher transaction', () => {
  const result = {
    actorUserId: actor, requestKey: key, payloadHash: digest,
    sessionIds: ['session-synthetic-1', 'session-synthetic-2'],
    skippedCount: 1, scenarioCount: 25,
  };
  function mockTx(count: number) {
    const updateMany = vi.fn().mockResolvedValue({ count });
    const tx = { roleplayCreationRequest: { updateMany } } as unknown as
      Pick<Prisma.TransactionClient, 'roleplayCreationRequest'>;
    return { tx, updateMany };
  }

  it('transitions only a matching pending record in the publisher transaction', async () => {
    const { tx, updateMany } = mockTx(1);
    await expect(completeRoleplayCreationInTransaction(tx, result)).resolves.toBeUndefined();
    expect(updateMany).toHaveBeenCalledOnce();
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        actorUserId: actor, requestKey: key, payloadHash: digest,
        status: 'IN_PROGRESS',
      },
      data: expect.objectContaining({
        status: 'COMPLETED',
        sessionIds: ['session-synthetic-1', 'session-synthetic-2'],
        createdCount: 2, skippedCount: 1, scenarioCount: 25,
        completedAt: expect.any(Date),
      }),
    });
  });

  it('fails closed when another publisher already finished or removed the claim', async () => {
    const { tx } = mockTx(0);
    await expect(completeRoleplayCreationInTransaction(tx, result))
      .rejects.toBeInstanceOf(InvalidRoleplayCreationKeyError);
  });

  it('never updates a ledger with no sessions, repeated IDs or bad counters', async () => {
    const { tx, updateMany } = mockTx(1);
    for (const invalid of [
      { ...result, sessionIds: [] },
      { ...result, sessionIds: ['duplicate', 'duplicate'] },
      { ...result, skippedCount: -1 },
      { ...result, scenarioCount: 26 },
      { ...result, payloadHash: 'invalid-hash' },
    ]) {
      await expect(completeRoleplayCreationInTransaction(tx, invalid))
        .rejects.toBeInstanceOf(InvalidRoleplayCreationKeyError);
    }
    expect(updateMany).not.toHaveBeenCalled();
  });
});
