// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readEmailHistory } from './delivery-history';

function fixture() {
  const query = vi.fn().mockResolvedValueOnce([{ installed: true }]).mockResolvedValueOnce([]);
  return { query, db: { $queryRaw: query } as unknown as Parameters<typeof readEmailHistory>[0] };
}
describe('read-only email delivery history', () => {
  it('distinguishes missing ledger from an empty visible history', async () => {
    const { db, query } = fixture();
    query.mockReset().mockResolvedValueOnce([{ installed: false }]);
    expect(await readEmailHistory(db)).toEqual({ status: 'not_installed' });
    expect(query).toHaveBeenCalledTimes(1);
    expect(await readEmailHistory(fixture().db)).toEqual({ status: 'ready', rows: [] });
  });
  it('returns unavailable on denied access without leaking errors', async () => {
    const { db, query } = fixture();
    query.mockReset().mockResolvedValueOnce([{ installed: true }]).mockRejectedValueOnce(new Error('private db credentials'));
    expect(await readEmailHistory(db)).toEqual({ status: 'unavailable' });
  });
  it('returns a bounded and minimal projection with serialized timestamps', async () => {
    const { db, query } = fixture();
    const createdAt = new Date('2026-11-24T05:00:00Z');
    query.mockReset().mockResolvedValueOnce([{ installed: true }]).mockResolvedValueOnce([{
      kind: 'application_received', status: 'unconfirmed', provider: 'mailjet', createdAt, claimedAt: createdAt, completedAt: createdAt,
      email: 'private@example.test', eventId: 'private-id',
    }]);
    expect(await readEmailHistory(db)).toEqual({ status: 'ready', rows: [{
      kind: 'application_received', status: 'unconfirmed', provider: 'mailjet', createdAt: createdAt.toISOString(), claimedAt: createdAt.toISOString(), completedAt: createdAt.toISOString(),
    }] });
    const sql = query.mock.calls[1][0].join('?');
    expect(sql).toContain('LIMIT 30');
    expect(sql).not.toMatch(/SELECT\s+\*/);
  });
  it('fails closed for unexpected status values', async () => {
    const { db, query } = fixture();
    query.mockReset().mockResolvedValueOnce([{ installed: true }]).mockResolvedValueOnce([{ kind: 'application_received', status: 'delivered' }]);
    expect(await readEmailHistory(db)).toEqual({ status: 'unavailable' });
  });
});
