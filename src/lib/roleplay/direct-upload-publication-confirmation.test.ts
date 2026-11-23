// @vitest-environment node
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { prepareNewRoleplayUploadReservation } from './direct-upload-reservation';
import { prepareRoleplayDirectUploadBatch } from './direct-upload-contract';
import { fingerprintRoleplayDirectUploadDeclarations } from './direct-upload-reservation-fingerprint';
import {
  inspectPublishedRoleplayUploadReferences,
  RoleplayPublicationConfirmationError,
} from './direct-upload-publication-confirmation';

const actor = 'synthetic-admin-A';
const otherActor = 'synthetic-admin-B';
const requestKey = '123e4567-e89b-42d3-a456-426614174000';
const batchId = '123e4567-e89b-42d3-a456-426614174001';
const now = 1_800_000_000_000;
const declarations = [
  { order: 0, mime: 'audio/mpeg', sizeBytes: 3, sha256: 'a'.repeat(64) },
  { order: 1, mime: 'audio/wav', sizeBytes: 4, sha256: 'b'.repeat(64) },
];
const items = prepareRoleplayDirectUploadBatch(batchId, declarations).items;
const fingerprint = fingerprintRoleplayDirectUploadDeclarations(
  prepareNewRoleplayUploadReservation(actor, declarations, now).reservation.items,
);

type Stored = {
  id: string; actorUserId: string; declarationHash: string; status: string;
  items: unknown; publishedSessionIds: unknown; createdAt: Date; expiresAt: Date;
};

const row = (patch: Partial<Stored> = {}): Stored => ({
  id: batchId, actorUserId: actor, declarationHash: fingerprint,
  status: 'PUBLISHED', items, publishedSessionIds: ['session-a', 'session-b'],
  createdAt: new Date(now - 30 * 60_000),
  expiresAt: new Date(now - 10_000),
  ...patch,
});

type Session = {
  id: string; status: string; baseAudioPath: string | null;
  scenarios: Array<{ order: number }>;
};
const session = (id: string, patch: Partial<Session> = {}): Session => ({
  id, status: 'INVITED', baseAudioPath: items[0].path,
  scenarios: [{ order: 0 }, { order: 1 }], ...patch,
});
function store(entry: Stored | null = row(), sessions: Session[] = [
  session('session-a'), session('session-b'),
]) {
  const findUnique = vi.fn().mockResolvedValue(entry);
  const findMany = vi.fn().mockResolvedValue(sessions);
  const create = vi.fn(); const updateMany = vi.fn(); const deleteMany = vi.fn();
  const db = {
    roleplayUploadReservation: { findUnique, create, updateMany },
    roleplaySession: { findMany, create, updateMany, deleteMany },
  } as unknown as Pick<PrismaClient, 'roleplayUploadReservation' | 'roleplaySession'>;
  return { db, findUnique, findMany, create, updateMany, deleteMany };
}

const inspect = (
  db: Pick<PrismaClient, 'roleplayUploadReservation' | 'roleplaySession'>,
  owner = actor, key = requestKey, data: unknown = declarations, clock = now,
) => inspectPublishedRoleplayUploadReferences(db, owner, key, data, clock);

describe('future read-only published upload receipt inspection (no HTTP)', () => {
  it('checks scoped reservation and every persisted session with only minimal metadata', async () => {
    const s = store();
    expect(await inspect(s.db)).toEqual({
      decision: 'REFERENCES_PRESENT_NEEDS_PROVENANCE_CHECK',
    });
    expect(s.findUnique).toHaveBeenCalledWith({
      where: { actorUserId_requestKey: { actorUserId: actor, requestKey } },
      select: {
        id: true, actorUserId: true, declarationHash: true, status: true,
        items: true, publishedSessionIds: true, createdAt: true, expiresAt: true,
      },
    });
    expect(s.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['session-a', 'session-b'] } },
      select: {
        id: true, status: true, baseAudioPath: true,
        scenarios: { select: { order: true } },
      },
    });
    expect(s.create).not.toHaveBeenCalled();
    expect(s.updateMany).not.toHaveBeenCalled();
    expect(s.deleteMany).not.toHaveBeenCalled();
  });

  it('does not read sessions for absent, unclaimed or mismatched admin requests', async () => {
    for (const [stored, owner, expected] of [
      [null, actor, 'NOT_FOUND'],
      [row(), otherActor, 'CONFLICT'],
      [row({ actorUserId: otherActor }), actor, 'CONFLICT'],
      [row({ declarationHash: 'c'.repeat(64) }), actor, 'CONFLICT'],
      [row({ status: 'VERIFYING', publishedSessionIds: [] }), actor, 'NOT_PUBLISHED'],
      [row({ status: 'CANCELLED', publishedSessionIds: [] }), actor, 'NOT_PUBLISHED'],
    ] as const) {
      const s = store(stored);
      expect(await inspect(s.db, owner)).toEqual({ decision: expected });
      expect(s.findMany).not.toHaveBeenCalled();
    }
  });

  it('denies claims when session IDs are missing, duplicated or swapped', async () => {
    for (const sessions of [
      [], [session('session-a')], [session('session-a'), session('session-a')],
      [session('session-a'), session('unrelated-session')],
    ]) {
      const s = store(row(), sessions);
      expect(await inspect(s.db)).toEqual({ decision: 'REVIEW_REQUIRED' });
    }
  });

  it('rejects sessions that are drafts or have a different batch path or scenario structure', async () => {
    const cases = [
      session('session-a', { status: 'DRAFT' }),
      session('session-a', { baseAudioPath: null }),
      session('session-a', { baseAudioPath: 'base/other-admin/private.mp3' }),
      session('session-a', { scenarios: [] }),
      session('session-a', { scenarios: [{ order: 0 }, { order: 0 }] }),
      session('session-a', { scenarios: [{ order: 0 }, { order: 2 }] }),
    ];
    for (const faulty of cases) {
      const s = store(row(), [faulty, session('session-b')]);
      expect(await inspect(s.db)).toEqual({ decision: 'REVIEW_REQUIRED' });
    }
  });

  it('refuses malformed publication receipts before selecting any session', async () => {
    const corrupt: Partial<Stored>[] = [
      { publishedSessionIds: [] },
      { publishedSessionIds: ['session-a', 'session-a'] },
      { publishedSessionIds: ['session-a', ''] },
      { publishedSessionIds: ['session-a', '../other/admin'] },
      { publishedSessionIds: Array.from({ length: 1001 }, (_, i) => 'session-' + i) },
      { publishedSessionIds: null },
      { status: 'RESERVED' },
      { status: 'OTHER', publishedSessionIds: [] },
      { createdAt: new Date('bad-date') },
      { createdAt: new Date(now + 1) },
      { expiresAt: new Date(now - 31 * 60_000) },
      { expiresAt: new Date(now + 60 * 60_000) },
      { id: 'another-unsafe-batch-id' },
      { items: [{ ...items[0], path: 'other/private.mp3' }, items[1]] },
      { items: [{ ...items[0], extra: 'injection' }, items[1]] },
      { items: [items[1], items[0]] },
    ];
    for (const bad of corrupt) {
      const s = store(row(bad));
      expect(await inspect(s.db)).toEqual({ decision: 'REVIEW_REQUIRED' });
      expect(s.findMany).not.toHaveBeenCalled();
    }
  });

  it('rejects untrusted request data without hitting PostgreSQL', async () => {
    const s = store();
    for (const [owner, key, input, clock] of [
      ['', requestKey, declarations, now],
      [actor, 'bad-key', declarations, now],
      [actor, requestKey, [], now],
      [actor, requestKey, [{ ...declarations[0], signedUrl: 'SECRET_URL' }], now],
      [actor, requestKey, declarations, -1],
    ] as const) {
      await expect(inspect(s.db, owner, key, input, clock))
        .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    expect(s.findUnique).not.toHaveBeenCalled();
  });

  it('never promotes a conflicting declaration hash to receipt confirmation', async () => {
    const s = store();
    const changed = [
      { ...declarations[0], sha256: 'c'.repeat(64) },
      declarations[1],
    ];
    expect(await inspect(s.db, actor, requestKey, changed))
      .toEqual({ decision: 'CONFLICT' });
    expect(s.findMany).not.toHaveBeenCalled();
  });

  it('redacts database errors and does not write or return private IDs', async () => {
    const s = store();
    s.findMany.mockRejectedValueOnce(new Error('PRIVATE_DATABASE_URL_AND_SESSION_PATH'));
    let error: unknown;
    try { await inspect(s.db); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(RoleplayPublicationConfirmationError);
    expect(error).toMatchObject({ code: 'STORE_UNAVAILABLE' });
    expect(String(error)).not.toContain('PRIVATE_DATABASE_URL_AND_SESSION_PATH');
    expect(s.create).not.toHaveBeenCalled();
    expect(s.updateMany).not.toHaveBeenCalled();
    expect(s.deleteMany).not.toHaveBeenCalled();
  });
});
