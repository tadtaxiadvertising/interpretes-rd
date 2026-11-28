import { describe, expect, it, vi } from 'vitest';
import { CREATION_RECEIPT_TIMEOUT_MS, formatCreationRecoveryReference, parseCreationRecoveryReference, recoverSingleRoleplayCreation } from './creation-receipt-browser';

const key = '123e4567-e89b-42d3-a456-426614174000';
const complete = { status: 'COMPLETED', createdCount: 1, skippedCount: 0, scenarioCount: 2, sessionIds: ['synthetic-session'] };

describe('single creation receipt recovery', () => {
  it('only sends the original request key to the private read endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, data: complete }));
    expect(await recoverSingleRoleplayCreation(key, 2, fetcher)).toEqual({ status: 'COMPLETED' });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/admin/roleplays/creation-receipt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestKey: key }), cache: 'no-store', signal: expect.any(AbortSignal),
    });
  });
  it.each(['headers', 'body'])('times out stalled %s and ignores late success', async stage => {
    vi.useFakeTimers();
    try {
      let finish!: (value: unknown) => void;
      const stalled = new Promise<unknown>(resolve => { finish = resolve; });
      const fetcher = vi.fn<typeof fetch>().mockImplementation(() => stage === 'headers'
        ? stalled as Promise<Response>
        : Promise.resolve({ ok: true, json: () => stalled } as Response));
      const result = recoverSingleRoleplayCreation(key, 2, fetcher);
      await vi.advanceTimersByTimeAsync(CREATION_RECEIPT_TIMEOUT_MS);
      expect(await result).toEqual({ status: 'UNAVAILABLE' });
      expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
      finish(stage === 'headers' ? Response.json({ success: true, data: complete }) : { success: true, data: complete });
      await Promise.resolve();
      expect(await result).toEqual({ status: 'UNAVAILABLE' });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      fetcher.mockResolvedValueOnce(Response.json({ success: true, data: complete }));
      expect(await recoverSingleRoleplayCreation(key, 2, fetcher)).toEqual({ status: 'COMPLETED' });
      expect(fetcher.mock.calls[1][1]?.body).toBe(JSON.stringify({ requestKey: key }));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
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
  it.each([
    [401, 'ACCESS_REQUIRED'], [403, 'ACCESS_REQUIRED'], [404, 'ENDPOINT_UNAVAILABLE'],
    [429, 'UNAVAILABLE'], [503, 'UNAVAILABLE'],
  ])('classifies HTTP %s without trusting the error body', async (httpStatus, status) => {
    const json = vi.fn().mockResolvedValue({ success: true, data: complete, error: 'private diagnostic' });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue({ ok: false, status: httpStatus, json } as unknown as Response);
    expect(await recoverSingleRoleplayCreation(key, 2, fetcher)).toEqual({ status });
    expect(json).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
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

describe('portable recovery reference', () => {
  it.each([1, 25])('round trips a valid reference with %s scenarios', scenarioCount => {
    const reference = { key, scenarioCount };
    const encoded = formatCreationRecoveryReference(reference);
    expect(parseCreationRecoveryReference(' ' + encoded + ' ')).toEqual(reference);
  });
  it.each(['', key, 'rp2:' + key + ':1', 'rp1:' + key + ':0', 'rp1:' + key + ':26',
    'rp1:' + key + ':01', 'rp1:' + key + ':1:extra', 'rp1:' + key.toUpperCase() + ':1',
    'rp1:invalid:1'])('rejects malformed recovery references (%s)', value => {
    expect(parseCreationRecoveryReference(value)).toBeNull();
  });
  it('cannot format a reference with an invalid scenario count', () => {
    expect(() => formatCreationRecoveryReference({ key, scenarioCount: 26 })).toThrow();
  });
});
