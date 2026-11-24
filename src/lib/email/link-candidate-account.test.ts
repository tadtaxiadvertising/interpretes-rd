// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { linkCandidateAccount } from './link-candidate-account';

const now = new Date('2026-11-24T05:00:00Z');
const ref = { candidateId: 1, applicationId: 'application-1', expiresAt: now.getTime() + 60000 };
const user = { id: '123e4567-e89b-42d3-a456-426614174000', email: 'candidate@example.test', email_confirmed_at: '2026-11-23T05:00:00Z' };
function fixture() {
  const execute = vi.fn().mockResolvedValue(1);
  const query = vi.fn().mockResolvedValue([{ matched: true }]);
  const db = { $executeRaw: execute, $queryRaw: query } as unknown as Parameters<typeof linkCandidateAccount>[0];
  return { db, execute, query };
}
describe('candidate email binding proof', () => {
  it('requires both an unexpired signed reference and a verified active session', async () => {
    const f = fixture();
    expect(await linkCandidateAccount(f.db, null, user, now)).toBe('not_eligible');
    expect(await linkCandidateAccount(f.db, ref, null, now)).toBe('not_eligible');
    expect(await linkCandidateAccount(f.db, { ...ref, expiresAt: now.getTime() }, user, now)).toBe('not_eligible');
    expect(await linkCandidateAccount(f.db, ref, { ...user, email_confirmed_at: undefined }, now)).toBe('not_eligible');
    expect(await linkCandidateAccount(f.db, ref, { ...user, is_anonymous: true }, now)).toBe('not_eligible');
    expect(await linkCandidateAccount(f.db, ref, { ...user, banned_until: '2026-11-25T05:00:00Z' }, now)).toBe('not_eligible');
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('binds only the matching application, candidate and verified profile without overwriting', async () => {
    const f = fixture();
    expect(await linkCandidateAccount(f.db, ref, user, now)).toBe('linked');
    const sql = f.execute.mock.calls[0][0].join('?');
    expect(sql).toContain('a.id = ?');
    expect(sql).toContain("p.role = 'candidate'");
    expect(sql).toContain('p.interpreter_id IS NULL');
    expect(sql).toContain('ON CONFLICT DO NOTHING');
    expect(f.execute.mock.calls[0].slice(1)).toEqual([user.id, ref.candidateId, ref.applicationId, user.email, user.email]);
  });
  it('distinguishes an identical active binding from a conflict or revoked binding', async () => {
    const f = fixture();
    f.execute.mockResolvedValue(0);
    expect(await linkCandidateAccount(f.db, ref, user, now)).toBe('already_linked');
    expect(f.query.mock.calls[0][0].join('?')).toContain('b.revoked_at IS NULL');
    f.query.mockResolvedValue([{ matched: false }]);
    expect(await linkCandidateAccount(f.db, ref, user, now)).toBe('conflict');
  });
  it('degrades safely if the staged table is unavailable', async () => {
    const f = fixture();
    f.execute.mockRejectedValue(new Error('private database detail'));
    expect(await linkCandidateAccount(f.db, ref, user, now)).toBe('unavailable');
  });
});
