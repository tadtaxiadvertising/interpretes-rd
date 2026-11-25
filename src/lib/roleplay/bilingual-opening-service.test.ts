import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { authorizeOpeningUpload, confirmOpeningUpload, recoverOpeningState } from './bilingual-opening-service';

const m = vi.hoisted(() => ({
  sign: vi.fn(), reserve: vi.fn(), claim: vi.fn(), verify: vi.fn(), complete: vi.fn(), read: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/roleplay', () => ({ createSignedBilingualOpeningUploadUrl: m.sign }));
vi.mock('./bilingual-opening-store', () => ({
  reserveBilingualOpeningPath: m.reserve, claimBilingualOpeningVerification: m.claim,
  completeBilingualOpeningVerification: m.complete, readBilingualOpeningState: m.read,
}));
vi.mock('./bilingual-opening-storage', () => ({ verifyBilingualOpeningAudio: m.verify }));

const db = {} as Pick<PrismaClient, '$transaction'>;
const id = 'session-1';
const actor = { role: 'interpreter', interpreterId: 7 } as const;
const path = 'openings/session-1/123e4567-e89b-42d3-a456-426614174000.webm';
const evidence = { sourceAudioPath: path, durationSec: 42 };

beforeEach(() => {
  vi.resetAllMocks();
  m.sign.mockImplementation(async (_id, _mime, _size, reserve) => {
    await reserve(path);
    return { token: 'test-token', path };
  });
  m.claim.mockResolvedValue({ kind: 'claimed', verificationId: 'lease-1' });
  m.verify.mockResolvedValue(evidence);
  m.complete.mockResolvedValue('created');
});

describe('staged opening service', () => {
  it('binds the generated object path to the authenticated actor before returning a capability', async () => {
    await expect(authorizeOpeningUpload(db, id, actor, { mimeType: 'audio/webm', size: 100 })).resolves.toEqual({ token: 'test-token', path });
    expect(m.reserve).toHaveBeenCalledWith(db, id, actor, path);
    m.reserve.mockRejectedValueOnce(new Error('conflict'));
    await expect(authorizeOpeningUpload(db, id, actor, { mimeType: 'audio/webm', size: 100 })).rejects.toThrow('conflict');
  });

  it('claims before decoding and persists only server-measured evidence', async () => {
    await expect(confirmOpeningUpload(db, id, actor, path)).resolves.toBe('created');
    expect(m.claim).toHaveBeenCalledWith(db, id, actor, path);
    expect(m.verify).toHaveBeenCalledWith(id, path);
    expect(m.complete).toHaveBeenCalledWith(db, id, actor, 'lease-1', evidence);
    expect(m.claim.mock.invocationCallOrder[0]).toBeLessThan(m.verify.mock.invocationCallOrder[0]);
    expect(m.verify.mock.invocationCallOrder[0]).toBeLessThan(m.complete.mock.invocationCallOrder[0]);
  });

  it('does not decode rejected or already confirmed uploads', async () => {
    m.claim.mockRejectedValueOnce(new Error('conflict'));
    await expect(confirmOpeningUpload(db, id, actor, path)).rejects.toThrow('conflict');
    m.claim.mockResolvedValueOnce({ kind: 'replayed' });
    await expect(confirmOpeningUpload(db, id, actor, path)).resolves.toBe('replayed');
    expect(m.verify).not.toHaveBeenCalled();
    expect(m.complete).not.toHaveBeenCalled();
  });

  it('does not persist failed verification and recovers database state separately', async () => {
    m.verify.mockRejectedValueOnce(new Error('invalid audio'));
    await expect(confirmOpeningUpload(db, id, actor, path)).rejects.toThrow('invalid audio');
    expect(m.complete).not.toHaveBeenCalled();
    m.read.mockResolvedValue('pending');
    await expect(recoverOpeningState(db, id, actor)).resolves.toBe('pending');
  });
});
