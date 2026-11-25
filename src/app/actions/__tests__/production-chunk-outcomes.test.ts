import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  validate: vi.fn(), findMany: vi.fn(), createMany: vi.fn(), refresh: vi.fn(),
}));
vi.mock('@/lib/auth/actions', () => ({ validateAction: mocks.validate }));
vi.mock('@/lib/prisma', () => ({ default: {
  interpreter: { findMany: mocks.findMany },
  productionLog: { createMany: mocks.createMany },
} }));
vi.mock('@/lib/cache/revalidate-interpreter', () => ({ revalidateInterpreterProfileRecords: mocks.refresh }));

import { uploadLogChunk } from '../production.actions';

const data = { headers: 'Date,External ID,Minutes,Adherence', rows: [
  '2026-11-01,TEST,10,90',
  '2026-11-02,TEST,20,95',
  '2026-11-03,UNKNOWN,30,100',
] };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.validate.mockResolvedValue({ user: { role: 'admin' } });
  mocks.findMany.mockResolvedValue([{ id: 1, externalId: 'TEST' }]);
  mocks.createMany.mockResolvedValue({ count: 1 });
});

describe('production chunk import outcomes', () => {
  it('reports actual inserts, skipped rows and rejected rows separately', async () => {
    const result = await uploadLogChunk(null, data);
    expect(result).toMatchObject({ success: true, count: 1, accepted: 2, skipped: 1, rejected: 1 });
    expect(mocks.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });
  it('does not treat a cache refresh failure as a failed insert', async () => {
    mocks.refresh.mockImplementation(() => { throw new Error('CACHE_FAILURE'); });
    expect(await uploadLogChunk(null, data)).toMatchObject({ success: true, count: 1 });
    expect(mocks.createMany).toHaveBeenCalledOnce();
  });
  it('distinguishes a rejected request before a write from an uncertain write', async () => {
    expect(await uploadLogChunk(null, { headers: '', rows: [] })).toMatchObject({ success: false, outcome: 'not-written' });
    expect(mocks.createMany).not.toHaveBeenCalled();
    mocks.createMany.mockRejectedValueOnce(new Error('DATABASE_CONNECTION_LOST'));
    expect(await uploadLogChunk(null, data)).toMatchObject({ success: false, outcome: 'uncertain' });
    expect(mocks.createMany).toHaveBeenCalledOnce();
  });
  it('keeps authorization rejection before writes', async () => {
    mocks.validate.mockResolvedValue({ error: 'Forbidden' });
    expect(await uploadLogChunk(null, data)).toMatchObject({ success: false, outcome: 'not-written' });
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.createMany).not.toHaveBeenCalled();
  });
});
