// @vitest-environment node
import type { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareRoleplayCreationClaim } from './prepare-creation-claim';
import { fingerprintRoleplayCreation } from './creation-idempotency-ledger';

const auth = vi.hoisted(() => ({ validate: vi.fn(), bearer: vi.fn() }));
vi.mock('@/lib/auth/actions', () => ({ validateAction: auth.validate }));
vi.mock('@/lib/api-auth', () => ({ actorFromBearer: auth.bearer }));

const actor = 'synthetic-admin';
const requestKey = '123e4567-e89b-42d3-a456-426614174000';
const metadata = {
  participantType: 'interpreter' as const, participantId: 12, requiresBilingualOpening: false,
  scenarios: [{ title: 'Synthetic', durationLimitSec: 120, scriptPrompt: null }],
};
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const audio = () => new File(['synthetic'], 'sample.mp3', { type: 'audio/mpeg' });
const req = (bearer = false) => new Request('http://localhost', {
  headers: bearer ? { Authorization: 'Bearer synthetic' } : {},
});
function store() {
  const create = vi.fn().mockResolvedValue({ id: 'claim' });
  const findUnique = vi.fn();
  const findMany = vi.fn();
  const db = { roleplayCreationRequest: { create, findUnique }, roleplaySession: { findMany } } as unknown as
    Pick<PrismaClient, 'roleplayCreationRequest' | 'roleplaySession'>;
  return { db, create, findUnique, findMany };
}
beforeEach(() => {
  vi.resetAllMocks();
  auth.validate.mockResolvedValue({ user: { role: 'admin', userId: actor } });
  auth.bearer.mockResolvedValue({ role: 'admin', userId: actor });
});

describe('authenticated creation preparation', () => {
  it.each([
    { error: 'Forbidden' }, { user: { role: 'interpreter', userId: actor } },
    { user: { role: 'admin', userId: '' } }, { user: { role: 'admin', userId: ' '.repeat(3) } },
    { user: { role: 'admin', userId: 'a'.repeat(257) } },
  ])('rejects invalid cookie identity before reading audio or writing the ledger', async identity => {
    auth.validate.mockResolvedValueOnce(identity);
    const { db, create } = store();
    const file = audio();
    const stream = vi.spyOn(file, 'stream');
    expect(await prepareRoleplayCreationClaim(db, req(), requestKey, metadata, {
      kind: 'upload', files: [file], checksums: null,
    })).toEqual({ kind: 'FORBIDDEN' });
    expect(stream).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  it.each([null, { role: 'admin', userId: 'another' }, { role: 'interpreter', userId: actor }])(
    'does not allow an unrelated or invalid explicit bearer', async bearer => {
      auth.bearer.mockResolvedValueOnce(bearer);
      const { db, create } = store();
      expect(await prepareRoleplayCreationClaim(db, req(true), requestKey, metadata, {
        kind: 'library', verifiedFingerprint: 'a'.repeat(64),
      })).toEqual({ kind: 'FORBIDDEN' });
      expect(create).not.toHaveBeenCalled();
    },
  );
  it('rejects bad request keys and mismatched scenario counts before reading bytes', async () => {
    const { db, create } = store();
    const file = audio();
    const stream = vi.spyOn(file, 'stream');
    const source = { kind: 'upload' as const, files: [file], checksums: null };
    await expect(prepareRoleplayCreationClaim(db, req(), 'bad', metadata, source)).rejects.toThrow();
    await expect(prepareRoleplayCreationClaim(db, req(), requestKey, { ...metadata, scenarios: [] }, source)).rejects.toThrow();
    expect(stream).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  it('never claims a package with an incorrect declared checksum', async () => {
    const { db, create } = store();
    await expect(prepareRoleplayCreationClaim(db, req(), requestKey, metadata, {
      kind: 'upload', files: [audio()], checksums: [hash('different')],
    })).rejects.toMatchObject({ reason: 'CHECKSUM_MISMATCH' });
    expect(create).not.toHaveBeenCalled();
  });
  it('claims using only the verified actor and actual bytes', async () => {
    const { db, create } = store();
    const result = await prepareRoleplayCreationClaim(db, req(true), requestKey, metadata, {
      kind: 'upload', files: [audio()], checksums: null,
    });
    const payloadHash = fingerprintRoleplayCreation({
      ...metadata, libraryFingerprint: null,
      audios: [{ mime: 'audio/mpeg', sizeBytes: 9, sha256: hash('synthetic') }],
    });
    expect(result).toEqual({ kind: 'CLAIMED', context: { actorUserId: actor, requestKey, payloadHash } });
    expect(create).toHaveBeenCalledExactlyOnceWith({
      data: { actorUserId: actor, requestKey, payloadHash, status: 'IN_PROGRESS' }, select: { id: true },
    });
  });
  it('returns no publisher context for a competing, unresolved claim', async () => {
    const { db, create, findUnique } = store();
    const verifiedFingerprint = 'b'.repeat(64);
    const payloadHash = fingerprintRoleplayCreation({ ...metadata, libraryFingerprint: verifiedFingerprint, audios: [] });
    create.mockRejectedValueOnce({ code: 'P2002' });
    findUnique.mockResolvedValueOnce({ actorUserId: actor, payloadHash, status: 'IN_PROGRESS' });
    expect(await prepareRoleplayCreationClaim(db, req(), requestKey, metadata, {
      kind: 'library', verifiedFingerprint,
    })).toEqual({ kind: 'IN_PROGRESS' });
    expect(create).toHaveBeenCalledOnce();
  });
});
