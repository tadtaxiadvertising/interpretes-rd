import { describe, expect, it, vi } from 'vitest';
import { recoverSingleRoleplayCreation } from './creation-receipt-browser';

const key = '123e4567-e89b-42d3-a456-426614174000';
const complete = { status: 'COMPLETED', createdCount: 1, skippedCount: 0, scenarioCount: 2, sessionIds: ['synthetic-session'] };

describe('single creation receipt recovery', () => {
  it('only sends the original request key to the private read endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, data: complete }));
    expect(await recoverSingleRoleplayCreation(key, 2, fetcher)).toEqual({ status: 'COMPLETED' });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/admin/roleplays/creation-receipt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestKey: key }), cache: 'no-store',
    });
  });
  it.each(['NOT_FOUND', 'IN_PROGRESS', 'REVIEW_REQUIRED'])('never converts %s into success', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, data: { status } }));
    expect(await recoverSingleRoleplayCreation(key, 2, fetcher)).toEqual({ status });
  });
  it.each([
    { createdCount: 2 }, { skippedCount: 1 }, { scenarioCount: 3 },
    { sessionIds: [] }, { sessionIds: ['a', 'b'] }, { sessionIds: [' '] }, { status: 'UNKNOWN' },
  ])('requires a coherent single-session receipt (%o)', async patch => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, data: { ...complete, ...patch } }));
    expect(await recoverSingleRoleplayCreation(key, 2, fetcher)).toEqual({ status: 'REVIEW_REQUIRED' });
  });
  it('does not interpret network, HTTP or malformed JSON failures as missing receipts', async () => {
    const fetcher = vi.fn<typeof fetch>();
    fetcher.mockRejectedValueOnce(new Error('transport'));
    fetcher.mockResolvedValueOnce(Response.json({ success: true, data: complete }, { status: 503 }));
    fetcher.mockResolvedValueOnce(new Response('not-json'));
    fetcher.mockResolvedValueOnce(Response.json({ success: false, data: complete }));
    for (let i = 0; i < 4; i++) {
      expect(await recoverSingleRoleplayCreation(key, 2, fetcher)).toEqual({ status: 'UNAVAILABLE' });
    }
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
