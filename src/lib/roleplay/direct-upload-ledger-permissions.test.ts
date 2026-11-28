import { describe, expect, it, vi } from 'vitest';
import { DIRECT_LEDGER_TABLES, DIRECT_LEDGER_PERMISSIONS_SQL, readDirectLedgerPermissions } from './direct-upload-ledger-permissions';
import type { ReservationCatalogReader } from './direct-upload-reservation-catalog';

const rows = () => DIRECT_LEDGER_TABLES.map(name => ({ name, runtime_access: true, private_access: true }));
function fixture(result: unknown[]) {
  const query = vi.fn().mockResolvedValue({ rows: result, rowCount: result.length });
  return { query, db: { query } as unknown as ReservationCatalogReader };
}

describe('direct upload ledger permission projection', () => {
  it('recognizes only the five expected tables and returns fixed fields', async () => {
    const f = fixture(rows().reverse().map(row => ({ ...row, private_detail: 'never-return' })));
    const result = await readDirectLedgerPermissions(f.db);
    expect(result).toEqual({ state: 'recognized', tables: DIRECT_LEDGER_TABLES.map(name => ({
      name, runtimeAccess: true, privateAccess: true,
    })) });
    expect(f.query).toHaveBeenCalledExactlyOnceWith(DIRECT_LEDGER_PERMISSIONS_SQL);
    expect(JSON.stringify(result)).not.toContain('never-return');
  });

  it.each(['runtime_access', 'private_access'] as const)('requires review if one table lacks %s', async field => {
    const resultRows = rows();
    resultRows[2][field] = false;
    const result = await readDirectLedgerPermissions(fixture(resultRows).db);
    expect(result.state).toBe('review-required');
    expect(result.tables[2]).toMatchObject(field === 'runtime_access' ? { runtimeAccess: false } : { privateAccess: false });
  });

  it.each(['missing', 'duplicate', 'unknown', 'nonboolean'])('rejects %s metadata', async mode => {
    const resultRows = rows() as { name: string; runtime_access: unknown; private_access: unknown }[];
    if (mode === 'missing') resultRows.pop();
    if (mode === 'duplicate') resultRows[0] = resultRows[1];
    if (mode === 'unknown') resultRows[0].name = 'unknown_private_table';
    if (mode === 'nonboolean') resultRows[0].runtime_access = 'true';
    expect(await readDirectLedgerPermissions(fixture(resultRows).db)).toEqual({ state: 'unavailable', tables: [] });
  });
});
