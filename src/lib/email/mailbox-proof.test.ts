// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { issueMailboxChallenge, consumeMailboxChallenge } from './mailbox-proof';

const binding = { candidateId: 1, accountId: '123e4567-e89b-42d3-a456-426614174000', email: 'candidate@example.test' };
function fixture() {
  const execute = vi.fn().mockResolvedValue(1);
  const query = vi.fn().mockResolvedValue([]);
  const db = { $executeRaw: execute, $queryRaw: query } as unknown as Parameters<typeof issueMailboxChallenge>[0];
  const send = vi.fn<(email: string, token: string) => Promise<'accepted' | 'unconfirmed'>>().mockResolvedValue('accepted');
  return { execute, query, db, send };
}
describe('independent mailbox proof', () => {
  it('stores only a hash and sends one unpredictable token after reserving the challenge', async () => {
    const f = fixture();
    expect(await issueMailboxChallenge(f.db, binding, f.send)).toBe('sent');
    const token = f.send.mock.calls[0][1];
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(f.execute.mock.calls[0]).toContain(createHash('sha256').update(token).digest('hex'));
    expect(f.execute.mock.calls[0]).not.toContain(token);
    expect(f.execute.mock.calls[0][0].join('?')).toContain("interval '5 minutes'");
    expect(f.send).toHaveBeenCalledExactlyOnceWith(binding.email, token);
    const sql = f.execute.mock.calls[0][0].join('?');
    expect(sql).toContain('b.challenge_email IS DISTINCT FROM ?');
    expect(sql).toContain('b.challenge_expires_at <= now()');
  });
  it('does not send if the binding is ineligible or cooldown is active', async () => {
    const f = fixture();
    f.execute.mockResolvedValue(0);
    expect(await issueMailboxChallenge(f.db, binding, f.send)).toBe('not_available');
    expect(f.send).not.toHaveBeenCalled();
  });
  it('recognizes an already verified mailbox without sending again', async () => {
    const f = fixture();
    f.execute.mockResolvedValue(0);
    f.query.mockResolvedValue([{ verified: true, pending: false }]);
    expect(await issueMailboxChallenge(f.db, binding, f.send)).toBe('already_verified');
    expect(f.send).not.toHaveBeenCalled();
    expect(f.query.mock.calls[0][0].join('?')).toContain('b.revoked_at IS NULL');
    expect(f.query.mock.calls[0]).toContain(binding.accountId);
  });
  it('recognizes a live challenge without sending or exposing its hash', async () => {
    const f = fixture();
    f.execute.mockResolvedValue(0);
    f.query.mockResolvedValue([{ verified: false, pending: true }]);
    expect(await issueMailboxChallenge(f.db, binding, f.send)).toBe('code_pending');
    expect(f.send).not.toHaveBeenCalled();
    expect(f.query.mock.calls[0][0].join('?')).toContain('b.challenge_expires_at > now()');
  });
  it('does not retry ambiguous SMTP acceptance', async () => {
    const f = fixture();
    f.send.mockRejectedValue(new Error('provider failure'));
    expect(await issueMailboxChallenge(f.db, binding, f.send)).toBe('unconfirmed');
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed tokens before database access and consumes only one matching live token', async () => {
    const f = fixture();
    expect(await consumeMailboxChallenge(f.db, binding, 'wrong')).toBe('invalid');
    expect(f.execute).not.toHaveBeenCalled();
    const token = 'a'.repeat(32);
    f.execute.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    expect(await consumeMailboxChallenge(f.db, binding, token)).toBe('verified');
    expect(await consumeMailboxChallenge(f.db, binding, token)).toBe('invalid');
    const sql = f.execute.mock.calls[0][0].join('?');
    expect(sql).toContain('challenge_hash = NULL');
    expect(sql).toContain('challenge_expires_at > now()');
    expect(sql).toContain('b.revoked_at IS NULL');
  });
});
