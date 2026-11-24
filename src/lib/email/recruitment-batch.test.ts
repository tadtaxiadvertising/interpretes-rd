// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { runEmailBatch, type BatchDependencies } from './recruitment-batch';
import { discoverEmailEvents } from './recruitment-batch-discovery';

function fixture() {
  return {
    discover: vi.fn<BatchDependencies['discover']>().mockResolvedValue(['a','b','c','d']),
    enqueue: vi.fn<BatchDependencies['enqueue']>().mockResolvedValue('queued'),
    process: vi.fn<BatchDependencies['process']>().mockResolvedValue('accepted'),
  };
}
describe('bounded recruitment email batches', () => {
  it('does not discover or send when disabled', async () => {
    const deps = fixture();
    expect((await runEmailBatch(false, deps)).status).toBe('disabled');
    expect(deps.discover).not.toHaveBeenCalled();
  });
  it('processes no more than three distinct events sequentially', async () => {
    const deps = fixture();
    deps.discover.mockResolvedValue(['a','a','b','c','d']);
    expect(await runEmailBatch(true, deps)).toEqual({ status: 'completed', examined: 3, accepted: 3, deferred: 0, cancelled: 0, uncertain: 0 });
    expect(deps.process.mock.calls).toEqual([['a'],['b'],['c']]);
  });
  it('stops after an uncertain result without attempting another email', async () => {
    const deps = fixture();
    deps.process.mockResolvedValueOnce('unconfirmed');
    expect(await runEmailBatch(true, deps)).toMatchObject({ status: 'review_required', examined: 1, uncertain: 1 });
    expect(deps.process).toHaveBeenCalledTimes(1);
  });
  it('stops on lost persistence and never retries', async () => {
    const deps = fixture();
    deps.process.mockResolvedValueOnce('reconciliation_required');
    expect((await runEmailBatch(true, deps)).status).toBe('review_required');
    expect(deps.process).toHaveBeenCalledTimes(1);
  });
  it('skips ineligible events and allows existing pending events to be processed', async () => {
    const deps = fixture();
    deps.enqueue.mockResolvedValueOnce('ineligible').mockResolvedValueOnce('duplicate');
    deps.process.mockResolvedValueOnce('not_claimed');
    expect(await runEmailBatch(true, deps)).toMatchObject({ examined: 3, deferred: 2, accepted: 1 });
    expect(deps.process.mock.calls).toEqual([['b'],['c']]);
  });
  it('redacts database errors and stops', async () => {
    const deps = fixture();
    deps.enqueue.mockRejectedValueOnce(new Error('secret'));
    expect(await runEmailBatch(true, deps)).toMatchObject({ status: 'unavailable', examined: 1 });
    expect(deps.process).not.toHaveBeenCalled();
  });
});
describe('event discovery query', () => {
  it('restricts events to the cutover, freshness, current state and active binding', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 'a', applicationId: 'app', eventType: 'APPLICATION_CREATED', toStatus: 'APPLIED' }, { id: 'b', applicationId: 'app', eventType: 'REJECTED', toStatus: 'REJECTED' }]);
    const db = { $queryRaw: query } as unknown as Parameters<typeof discoverEmailEvents>[0];
    const now = new Date('2026-11-24T06:00:00Z');
    expect(await discoverEmailEvents(db, new Date('2026-11-22T00:00:00Z'), now)).toEqual(['a']);
    expect(query.mock.calls[0].slice(1)).toEqual([new Date('2026-11-23T06:00:00Z'), now, null, null]);
    const sql = query.mock.calls[0][0].join('?');
    expect(sql).toContain('b.revoked_at IS NULL');
    expect(sql).toContain("d.status = 'pending'");
    expect(sql).toContain('a.status = e.to_status');
    expect(sql).toContain('LIMIT 3');
  });
});
