import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { verifyDirectUploadSlot } from './direct-upload-verify-slot';
import { prepareRoleplayDirectUploadBatch } from './direct-upload-contract';
import { fingerprintRoleplayDirectUploadDeclarations } from './direct-upload-reservation-fingerprint';

vi.mock('server-only', () => ({}));
const id = '123e4567-e89b-42d3-a456-426614174000';
const key = '123e4567-e89b-42d3-a456-426614174001';
const items = prepareRoleplayDirectUploadBatch(id, [0,1].map(order => ({ order, mime: 'audio/mpeg', sizeBytes: 100, sha256: 'a'.repeat(64) }))).items;
function fixture() {
  const createdAt = new Date(Date.now() - 1000);
  const row = { id, actorUserId: 'admin', requestKey: key, status: 'RESERVED', items,
    verifiedObjects: [] as unknown[], declarationHash: fingerprintRoleplayDirectUploadDeclarations(items),
    createdAt, expiresAt: new Date(createdAt.getTime() + 30 * 60_000) };
  const findUnique = vi.fn().mockResolvedValue(row);
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const db = { roleplayUploadReservation: { findUnique, updateMany } } as unknown as Pick<PrismaClient,'roleplayUploadReservation'>;
  const verify = vi.fn().mockResolvedValue({ sizeBytes: 100, sha256: 'a'.repeat(64) });
  return { row, db, findUnique, updateMany, verify };
}
describe('direct upload verification progress', () => {
  it('persists only the next slot, then promotes the complete batch', async () => {
    const f = fixture();
    expect(await verifyDirectUploadSlot(f.db,'admin',key,0,f.verify)).toEqual({kind:'PROGRESS',verifiedCount:1,total:2,complete:false});
    expect(f.verify).toHaveBeenCalledWith(items[0]);
    const first = f.updateMany.mock.calls[0][0];
    expect(first.where).toMatchObject({status:'RESERVED',verifiedObjects:{equals:[]}});
    expect(first.data.status).toBe('RESERVED');
    f.row.verifiedObjects = first.data.verifiedObjects;
    expect(await verifyDirectUploadSlot(f.db,'admin',key,0,f.verify)).toMatchObject({verifiedCount:1});
    expect(f.verify).toHaveBeenCalledTimes(1);
    expect(await verifyDirectUploadSlot(f.db,'admin',key,1,f.verify)).toEqual({kind:'PROGRESS',verifiedCount:2,total:2,complete:true});
    expect(f.updateMany.mock.calls[1][0].data.status).toBe('VERIFIED');
  });
  it('refuses foreign owners and out-of-order files without reading Storage', async () => {
    const f = fixture();
    expect(await verifyDirectUploadSlot(f.db,'other',key,0,f.verify)).toEqual({kind:'NOT_FOUND'});
    expect(await verifyDirectUploadSlot(f.db,'admin',key,1,f.verify)).toEqual({kind:'OUT_OF_ORDER'});
    expect(f.verify).not.toHaveBeenCalled();
    expect(f.updateMany).not.toHaveBeenCalled();
  });
  it('never persists mismatched bytes or a failed verification', async () => {
    const f = fixture();
    f.verify.mockResolvedValueOnce({sizeBytes:99,sha256:'a'.repeat(64)});
    await expect(verifyDirectUploadSlot(f.db,'admin',key,0,f.verify)).rejects.toThrow();
    f.verify.mockRejectedValueOnce(new Error('unavailable'));
    await expect(verifyDirectUploadSlot(f.db,'admin',key,0,f.verify)).rejects.toThrow();
    expect(f.updateMany).not.toHaveBeenCalled();
  });
  it('does not report success when a competing update wins', async () => {
    const f = fixture();
    f.updateMany.mockResolvedValueOnce({count:0});
    expect(await verifyDirectUploadSlot(f.db,'admin',key,0,f.verify)).toEqual({kind:'RETRY'});
  });
  it('rejects altered persisted paths before verifying', async () => {
    const f = fixture();
    f.findUnique.mockResolvedValue({...f.row,items:[{...items[0],path:'foreign'},items[1]]});
    await expect(verifyDirectUploadSlot(f.db,'admin',key,0,f.verify)).rejects.toThrow();
    expect(f.verify).not.toHaveBeenCalled();
  });
});
