// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readEmailDatabaseReadiness } from './database-readiness';

const valid = { delivery: true, binding: true, runtimeAccess: true, privateAccess: true, rls: true };
function fixture() {
  const query = vi.fn().mockResolvedValue([valid]);
  const db = { $queryRaw: query } as unknown as Parameters<typeof readEmailDatabaseReadiness>[0];
  return { db, query };
}
describe('email database metadata readiness', () => {
  it('distinguishes missing tables from permission errors', async () => {
    const f = fixture();
    f.query.mockResolvedValueOnce([{ ...valid, binding: false }]);
    expect(await readEmailDatabaseReadiness(f.db)).toEqual({ status: 'not_installed' });
    for (const key of ['runtimeAccess', 'privateAccess', 'rls']) {
      f.query.mockResolvedValueOnce([{ ...valid, [key]: false }]);
      expect(await readEmailDatabaseReadiness(f.db)).toEqual({ status: 'permission_mismatch' });
    }
  });
  it('uses actual current_user and checks all private API roles', async () => {
    const f = fixture();
    expect(await readEmailDatabaseReadiness(f.db)).toEqual({ status: 'ready' });
    const sql = f.query.mock.calls[0][0].join('?');
    expect(sql).toContain('has_table_privilege(current_user');
    expect(sql).toContain("'anon','authenticated','service_role'");
    expect(sql).toContain('relrowsecurity');
    expect(sql).not.toMatch(/\b(INSERT INTO|UPDATE private_email|DELETE FROM)\b/i);
  });
  it('sanitizes database errors and missing metadata', async () => {
    const f = fixture();
    f.query.mockRejectedValueOnce(new Error('private connection detail')).mockResolvedValueOnce([]);
    expect(await readEmailDatabaseReadiness(f.db)).toEqual({ status: 'unavailable' });
    expect(await readEmailDatabaseReadiness(f.db)).toEqual({ status: 'unavailable' });
  });
});
