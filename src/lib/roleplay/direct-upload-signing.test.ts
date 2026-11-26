import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { reserveAndSignDirectUpload } from './direct-upload-signing';
import { prepareRoleplayDirectUploadBatch } from './direct-upload-contract';
import { fingerprintRoleplayDirectUploadDeclarations } from './direct-upload-reservation-fingerprint';

vi.mock('server-only', () => ({}));
const m = vi.hoisted(() => ({ claim: vi.fn() }));
vi.mock('./direct-upload-reservation-ledger', () => ({ claimRoleplayDirectUploadReservation: m.claim }));
const batchId = '123e4567-e89b-42d3-a456-426614174000';
const requestKey = '123e4567-e89b-42d3-a456-426614174001';
const declarations = [{ order: 0, mime: 'audio/mpeg', sizeBytes: 100, sha256: 'a'.repeat(64) }];
const items = prepareRoleplayDirectUploadBatch(batchId, declarations).items;
function fixture() {
  const createdAt = new Date(Date.now() - 1000);
  const record = { id: batchId, actorUserId: 'admin', requestKey, status: 'RESERVED', items,
    declarationHash: fingerprintRoleplayDirectUploadDeclarations(items),
    createdAt, expiresAt: new Date(createdAt.getTime() + 30 * 60_000) };
  const findUnique = vi.fn().mockResolvedValue(record);
  const charge = vi.fn().mockResolvedValue([{slots:1}]);
  const db = { roleplayUploadReservation: { findUnique }, $queryRaw:charge } as unknown as Pick<PrismaClient,'roleplayUploadReservation'|'$queryRaw'>;
  const sign = vi.fn().mockResolvedValue({ data: { path: items[0].path, token: 'fixture-token' }, error: null });
  const storage = {
    getBucket: vi.fn().mockResolvedValue({ error: null, data: { id: 'roleplay-audio-private', name: 'roleplay-audio-private',
      public: false, file_size_limit: 15 * 1024 * 1024, allowed_mime_types: ['audio/mpeg','audio/wav','audio/webm','audio/mp4'] } }),
    from: vi.fn(() => ({ createSignedUploadUrl: sign })),
  };
  return { db, findUnique, sign, storage, record, charge };
}
beforeEach(() => { vi.resetAllMocks(); m.claim.mockResolvedValue({ kind: 'CREATED', batchId }); });
describe('persisted direct upload signing', () => {
  it('signs only canonical stored slots after the reservation claim', async () => {
    const f = fixture();
    expect(await reserveAndSignDirectUpload(f.db, f.storage, 'admin', requestKey, declarations)).toMatchObject({
      kind: 'CREATED', batchId, slots: [{ ...items[0], token: 'fixture-token' }],
    });
    expect(f.storage.from).toHaveBeenCalledWith('roleplay-audio-private');
    expect(f.sign).toHaveBeenCalledWith(items[0].path, { upsert: false });
    expect(m.claim.mock.invocationCallOrder[0]).toBeLessThan(f.sign.mock.invocationCallOrder[0]);
  });
  it('fails closed when a committed budget charge is missing or inconsistent', async () => {
    for(const rows of [[],[{slots:2}]]){
      const f=fixture();f.charge.mockResolvedValueOnce(rows);
      await expect(reserveAndSignDirectUpload(f.db,f.storage,'admin',requestKey,declarations)).rejects.toThrow('DIRECT_UPLOAD_BUDGET_UNAVAILABLE');
      expect(f.sign).not.toHaveBeenCalled();
    }
    const f=fixture();f.charge.mockRejectedValueOnce(new Error('missing table'));
    await expect(reserveAndSignDirectUpload(f.db,f.storage,'admin',requestKey,declarations)).rejects.toThrow();
    expect(f.sign).not.toHaveBeenCalled();
  });
  it('does not reissue capabilities for duplicate requests', async () => {
    const f = fixture();
    m.claim.mockResolvedValue({ kind: 'RECONCILE' });
    expect(await reserveAndSignDirectUpload(f.db, f.storage, 'admin', requestKey, declarations)).toEqual({ kind: 'RECONCILE' });
    expect(f.findUnique).not.toHaveBeenCalled();
    expect(f.sign).not.toHaveBeenCalled();
  });
  it('rejects wrong owner, stale reservation and altered stored path', async () => {
    for (const changes of [{ actorUserId: 'other' }, { expiresAt: new Date(0) }, { items: [{ ...items[0], path: 'foreign' }] }]) {
      const f = fixture();
      f.findUnique.mockResolvedValue({ ...f.record, ...changes });
      await expect(reserveAndSignDirectUpload(f.db, f.storage, 'admin', requestKey, declarations)).rejects.toThrow();
      expect(f.sign).not.toHaveBeenCalled();
    }
  });
  it('never claims a reservation when private storage is unavailable', async () => {
    const f = fixture();
    f.storage.getBucket.mockResolvedValue({ error: null, data: { public: true } });
    await expect(reserveAndSignDirectUpload(f.db, f.storage, 'admin', requestKey, declarations)).rejects.toThrow();
    expect(m.claim).not.toHaveBeenCalled();
  });
});
