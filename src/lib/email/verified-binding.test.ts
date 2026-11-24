// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { loadDispatchSnapshot } from './verified-binding';

const now = new Date('2026-11-24T05:00:00Z');
const accountId = '123e4567-e89b-42d3-a456-426614174000';
const email = 'candidate@example.test';
function fixture() {
  const findUnique = vi.fn().mockResolvedValue({
    id: 'event-1', applicationId: 'app-1', eventType: 'APPLICATION_CREATED', toStatus: 'APPLIED', createdAt: now,
    application: { id: 'app-1', status: 'APPLIED', candidateId: 1, candidate: { email } },
  });
  const binding = { candidateId: 1, accountId, profileEmail: email, verifiedEmail: email, mailboxVerifiedAt: new Date('2026-11-24T04:00:00Z'), role: 'candidate', interpreterId: null };
  const query = vi.fn().mockResolvedValue([binding]);
  const user = { id: accountId, email, email_confirmed_at: '2026-11-23T05:00:00Z', is_anonymous: false };
  const lookup = vi.fn().mockResolvedValue(user);
  const db = { recruitmentEvent: { findUnique }, $queryRaw: query } as unknown as Parameters<typeof loadDispatchSnapshot>[0];
  return { db, findUnique, query, lookup, user, binding };
}
describe('verified recruitment account binding', () => {
  it('uses the persisted account UUID and a fresh authoritative lookup', async () => {
    const f = fixture();
    const result = await loadDispatchSnapshot(f.db, 'event-1', f.lookup, now);
    expect(result?.identity).toEqual({ candidateId: 1, accountId, email, verified: true, active: true });
    expect(f.lookup).toHaveBeenCalledWith(accountId);
    expect(f.query.mock.calls[0][0].join('?')).toContain('b.revoked_at IS NULL');
    expect(f.query.mock.calls[0].slice(1)).toEqual([1]);
  });
  it('does not search by email when an explicit binding is missing', async () => {
    const f = fixture();
    f.query.mockResolvedValue([]);
    expect((await loadDispatchSnapshot(f.db, 'event-1', f.lookup, now))?.identity).toBeNull();
    expect(f.lookup).not.toHaveBeenCalled();
  });
  it('rejects a noncandidate profile or an email mismatch before the auth request', async () => {
    const f = fixture();
    for (const binding of [{ ...f.binding, role: 'admin' }, { ...f.binding, interpreterId: 3 }, { ...f.binding, profileEmail: 'other@example.test' }, { ...f.binding, verifiedEmail: null }, { ...f.binding, verifiedEmail: 'old@example.test' }, { ...f.binding, mailboxVerifiedAt: null }]) {
      f.query.mockResolvedValue([binding]);
      expect((await loadDispatchSnapshot(f.db, 'event-1', f.lookup, now))?.identity).toBeNull();
    }
    expect(f.lookup).not.toHaveBeenCalled();
  });
  it('rejects changed, anonymous, unconfirmed, banned or missing auth identities', async () => {
    const f = fixture();
    for (const user of [null, { ...f.user, id: 'other-id' }, { ...f.user, email: 'other@example.test' },
      { ...f.user, is_anonymous: true }, { ...f.user, email_confirmed_at: undefined },
      { ...f.user, banned_until: '2026-11-25T05:00:00Z' }]) {
      f.lookup.mockResolvedValue(user);
      expect((await loadDispatchSnapshot(f.db, 'event-1', f.lookup, now))?.identity).toBeNull();
    }
  });
  it('does not look up identity for a missing event', async () => {
    const f = fixture();
    f.findUnique.mockResolvedValue(null);
    expect(await loadDispatchSnapshot(f.db, 'event-1', f.lookup, now)).toBeNull();
    expect(f.query).not.toHaveBeenCalled();
    expect(f.lookup).not.toHaveBeenCalled();
  });
  it('propagates unavailable auth lookup so the dispatcher can reconcile', async () => {
    const f = fixture();
    f.lookup.mockRejectedValue(new Error('unavailable'));
    await expect(loadDispatchSnapshot(f.db, 'event-1', f.lookup, now)).rejects.toThrow('unavailable');
  });
});
