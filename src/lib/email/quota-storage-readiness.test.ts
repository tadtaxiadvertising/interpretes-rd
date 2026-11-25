// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { inspectQuotaStorage } from './quota-storage-readiness';

const ready = { installed: true, privateAccess: true, runtimeAccess: true, rls: true };
describe('quota storage readiness', () => {
  it('checks metadata and reports ready without reading credentials or updating counters', async () => {
    const query = vi.fn().mockResolvedValue([ready]);
    expect(await inspectQuotaStorage({ $queryRaw: query } as Pick<Prisma.TransactionClient, '$queryRaw'>)).toBe('ready');
    expect(query).toHaveBeenCalledTimes(1);
    const sql = query.mock.calls[0][0].join('');
    expect(sql).toContain("to_regclass('private_email.provider_quota')");
    expect(sql).toContain("has_table_privilege(current_user,q,'UPDATE')");
    expect(sql).toContain('row_security_active(q)');
    expect(sql).not.toMatch(/UPDATE\s+private_email|sealed_key|provider_profile/i);
  });
  it.each([
    [{ ...ready, installed: false }, 'not_installed'],
    [{ ...ready, privateAccess: false }, 'permission_mismatch'],
    [{ ...ready, runtimeAccess: false }, 'permission_mismatch'],
    [{ ...ready, rls: false }, 'permission_mismatch'],
  ] as const)('classifies incomplete or unsafe storage conservatively', async (row, expected) => {
    const query = vi.fn().mockResolvedValue([row]);
    expect(await inspectQuotaStorage({ $queryRaw: query } as Pick<Prisma.TransactionClient, '$queryRaw'>)).toBe(expected);
  });
  it('returns unavailable on empty results or connection errors', async () => {
    const query = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('private details'));
    const db = { $queryRaw: query } as Pick<Prisma.TransactionClient, '$queryRaw'>;
    expect(await inspectQuotaStorage(db)).toBe('unavailable');
    expect(await inspectQuotaStorage(db)).toBe('unavailable');
  });
});
