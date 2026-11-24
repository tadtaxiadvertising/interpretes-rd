// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { inspectEmailPilot } from './pilot-preflight';
import type { DispatchSnapshot } from './dispatch-eligibility';

const mocks = vi.hoisted(() => ({ readiness: vi.fn(), database: vi.fn(), discover: vi.fn() }));
vi.mock('./automation-status', () => ({ emailRolloutReadiness: mocks.readiness }));
vi.mock('./database-readiness', () => ({ readEmailDatabaseReadiness: mocks.database }));
vi.mock('./recruitment-batch-discovery', () => ({ discoverEmailEvents: mocks.discover }));

const now = new Date('2026-11-24T12:00:00Z');
const env = { OPERATIONAL_EMAIL_PILOT_RECIPIENT: 'test@example.test', OPERATIONAL_EMAIL_DISPATCH_NOT_BEFORE: '2026-11-24T00:00:00Z' };
const snapshot: DispatchSnapshot = {
  event: { id: 'event-1', applicationId: 'app-1', eventType: 'APPLICATION_CREATED', toStatus: 'APPLIED', createdAt: now },
  application: { id: 'app-1', status: 'APPLIED', candidateId: 1, email: 'test@example.test' },
  identity: { candidateId: 1, accountId: 'account-1', email: 'test@example.test', verified: true, active: true },
};
const good = { linked: true, verified: true, pending: false, uncertain: false };
function fixture() {
  vi.resetAllMocks();
  mocks.readiness.mockReturnValue({ mode: 'pilot', ready: true });
  mocks.database.mockResolvedValue({ status: 'ready' });
  mocks.discover.mockResolvedValue(['event-1']);
  const query = vi.fn().mockResolvedValue([good]);
  const db = { $queryRaw: query } as unknown as Parameters<typeof inspectEmailPilot>[0];
  const load = vi.fn().mockResolvedValue(snapshot);
  const inspect = () => inspectEmailPilot(db, env, load, now);
  return { query, db, load, inspect };
}
describe('read-only pilot preflight', () => {
  it('returns ready only for a fresh eligible event and the configured recipient', async () => {
    const f = fixture();
    expect(await f.inspect()).toEqual({ status: 'ready' });
    expect(f.load).toHaveBeenCalledExactlyOnceWith('event-1');
    expect(mocks.discover).toHaveBeenCalledWith(f.db, new Date(env.OPERATIONAL_EMAIL_DISPATCH_NOT_BEFORE), now, 'test@example.test');
    expect(f.query.mock.calls[0][0].join('?')).toContain('b.revoked_at IS NULL');
  });
  it('skips all queries when the configuration is incomplete', async () => {
    const f = fixture();
    mocks.readiness.mockReturnValue({ mode: 'pilot', ready: false });
    expect(await f.inspect()).toEqual({ status: 'configuration_pending' });
    expect(mocks.database).not.toHaveBeenCalled();
    expect(f.query).not.toHaveBeenCalled();
  });
  it('does not read candidate records when private schema is unavailable', async () => {
    const f = fixture();
    mocks.database.mockResolvedValue({ status: 'not_installed' });
    expect(await f.inspect()).toEqual({ status: 'database_pending' });
    expect(f.query).not.toHaveBeenCalled();
  });
  it.each([
    [[], 'candidate_missing'],
    [[good, good], 'review_required'],
    [[{ ...good, linked: false }], 'binding_missing'],
    [[{ ...good, verified: false }], 'mailbox_unverified'],
    [[{ ...good, verified: false, pending: true }], 'mailbox_pending'],
    [[{ ...good, uncertain: true }], 'review_required'],
  ])('classifies missing prerequisites without loading an event', async (rows, status) => {
    const f = fixture();
    f.query.mockResolvedValue(rows);
    expect(await f.inspect()).toEqual({ status });
    expect(mocks.discover).not.toHaveBeenCalled();
    expect(f.load).not.toHaveBeenCalled();
  });
  it('distinguishes no available event from successful SMTP acceptance', async () => {
    const f = fixture();
    mocks.discover.mockResolvedValue([]);
    expect(await f.inspect()).toEqual({ status: 'no_event' });
    expect(f.load).not.toHaveBeenCalled();
  });
  it('rejects stale, missing or mismatched identity before declaring readiness', async () => {
    const f = fixture();
    f.load.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...snapshot, identity: null });
    expect(await f.inspect()).toEqual({ status: 'identity_unverified' });
    expect(await f.inspect()).toEqual({ status: 'identity_unverified' });
  });
  it('redacts unexpected database errors', async () => {
    const f = fixture();
    f.query.mockRejectedValue(new Error('private details'));
    expect(await f.inspect()).toEqual({ status: 'unavailable' });
  });
});
