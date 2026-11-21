// @vitest-environment node
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  InvalidRoleplayReceiptRequestError,
  lookupRoleplayCreationReceipt,
  parseRoleplayReceiptRequest,
} from './creation-receipt';

const actor = 'admin-synthetic-A';
const key = '123e4567-e89b-42d3-a456-426614174000';

function mockDb(record: unknown = null, ids: string[] = []) {
  const findUnique = vi.fn().mockResolvedValue(record);
  const findMany = vi.fn().mockResolvedValue(ids.map(id => ({ id })));
  const db = {
    roleplayCreationRequest: { findUnique },
    roleplaySession: { findMany },
  } as unknown as Pick<PrismaClient, 'roleplayCreationRequest' | 'roleplaySession'>;
  return { db, findUnique, findMany };
}

function complete(overrides: Record<string, unknown> = {}) {
  return {
    status: 'COMPLETED',
    completedAt: new Date('2026-11-21T12:00:00Z'),
    sessionIds: ['session-a', 'session-b'],
    createdCount: 2, skippedCount: 1, scenarioCount: 25,
    ...overrides,
  };
}

describe('Roleplay creation receipt validation', () => {
  it('requires one lowercase UUID v4/v7 and no extra JSON fields', () => {
    expect(parseRoleplayReceiptRequest({ requestKey: key })).toBe(key);
    for (const bad of [
      {}, [], 'not-json', null, { requestKey: '' },
      { requestKey: key.toUpperCase() },
      { requestKey: '../../../private' },
      { requestKey: '123e4567-e89b-12d3-a456-426614174000' },
      { requestKey: key, actorUserId: 'other-admin' },
    ]) {
      expect(() => parseRoleplayReceiptRequest(bad))
        .toThrowError(InvalidRoleplayReceiptRequestError);
    }
  });

  it('returns NOT_FOUND for a different admin without reading session IDs', async () => {
    const { db, findUnique, findMany } = mockDb();
    expect(await lookupRoleplayCreationReceipt(db, 'another-admin', key))
      .toEqual({ status: 'NOT_FOUND' });
    expect(findUnique).toHaveBeenCalledWith({
      where: { actorUserId_requestKey: { actorUserId: 'another-admin', requestKey: key } },
      select: expect.objectContaining({ sessionIds: true, completedAt: true }),
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('reports ongoing/unknown commits without releasing or reclaiming the key', async () => {
    const { db, findMany } = mockDb({ status: 'IN_PROGRESS' });
    expect(await lookupRoleplayCreationReceipt(db, actor, key))
      .toEqual({ status: 'IN_PROGRESS' });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('confirms completed results only after verifying all session IDs still exist', async () => {
    const { db, findMany } = mockDb(complete(), ['session-b', 'session-a']);
    const result = await lookupRoleplayCreationReceipt(db, actor, key);
    expect(result).toEqual({
      status: 'COMPLETED',
      sessionIds: ['session-a', 'session-b'], createdCount: 2,
      skippedCount: 1, scenarioCount: 25,
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ['session-a', 'session-b'] } },
      select: { id: true },
    });
  });

  it('never reports COMPLETED if the participant sessions were deleted or changed', async () => {
    for (const ids of [
      ['session-a'], [],
      ['session-a', 'unknown-session'],
      ['session-a', 'session-a'],
    ]) {
      const { db } = mockDb(complete(), ids);
      expect(await lookupRoleplayCreationReceipt(db, actor, key))
        .toEqual({ status: 'REVIEW_REQUIRED' });
    }
  });

  it('rejects corrupted counters, duplicate IDs and unknown statuses before scanning sessions', async () => {
    for (const bad of [
      complete({ completedAt: null }),
      complete({ createdCount: 0 }),
      complete({ createdCount: 3 }),
      complete({ skippedCount: -1 }),
      complete({ scenarioCount: 26 }),
      complete({ sessionIds: ['same', 'same'] }),
      complete({ status: 'FAILED' }),
      complete({ createdCount: 1001, sessionIds: Array.from({ length: 1001 }, (_, i) => String(i)) }),
    ]) {
      const { db, findMany } = mockDb(bad);
      expect(await lookupRoleplayCreationReceipt(db, actor, key))
        .toEqual({ status: 'REVIEW_REQUIRED' });
      expect(findMany).not.toHaveBeenCalled();
    }
  });

  it('does not hit the database for malformed actor IDs or request keys', async () => {
    const { db, findUnique } = mockDb();
    await expect(lookupRoleplayCreationReceipt(db, '', key))
      .rejects.toBeInstanceOf(InvalidRoleplayReceiptRequestError);
    await expect(lookupRoleplayCreationReceipt(db, actor, 'not-key'))
      .rejects.toBeInstanceOf(InvalidRoleplayReceiptRequestError);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('propagates database/migration errors instead of inventing a successful receipt', async () => {
    const { db, findUnique } = mockDb();
    findUnique.mockRejectedValueOnce({ code: 'P2021', message: 'PRIVATE_POSTGRES_DSN' });
    await expect(lookupRoleplayCreationReceipt(db, actor, key))
      .rejects.toMatchObject({ code: 'P2021' });
  });
});
