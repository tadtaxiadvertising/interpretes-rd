// @vitest-environment node
import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { VPN_COLUMN_TYPES } from '../../scripts/account-platform-vpn-schema';
import { inspectAccountVpnSchema } from './account-vpn-schema-readiness';

const columns = Object.entries(VPN_COLUMN_TYPES).map(([column_name, data_type]) => ({
  column_name, data_type, is_nullable: 'YES',
}));
const validConstraint = {
  definition: 'CHECK (((vpn_port IS NULL) OR ((vpn_port >= 1) AND (vpn_port <= 65535))))',
};

function fakePool(rows: typeof columns, definitions: Array<{ definition: string }>) {
  const query = vi.fn()
    .mockResolvedValueOnce({ rows })
    .mockResolvedValueOnce({ rows: definitions });
  return { query } as unknown as Pick<Pool, 'query'>;
}

describe('operational account list tolerates VPN schema drift safely', () => {
  it('detects the complete VPN schema without reading account rows', async () => {
    const pool = fakePool(columns, [validConstraint]);
    expect(await inspectAccountVpnSchema(pool)).toBe('complete');
  });

  it('identifies a pristine pre-VPN schema', async () => {
    expect(await inspectAccountVpnSchema(fakePool([], []))).toBe('missing');
  });

  it('does not interpret a missing vpn_country column as a safe rollout', async () => {
    const incomplete = columns.filter(column => column.column_name !== 'vpn_country');
    expect(await inspectAccountVpnSchema(fakePool(incomplete, [validConstraint]))).toBe('partial');
  });

  it('rejects fake CHECK and mismatched VPN data types', async () => {
    expect(await inspectAccountVpnSchema(fakePool(columns, [{ definition: 'CHECK (true)' }]))).toBe('partial');
    const mistyped = columns.map(column =>
      column.column_name === 'vpn_country' ? { ...column, data_type: 'integer' } : column);
    expect(await inspectAccountVpnSchema(fakePool(mistyped, [validConstraint]))).toBe('partial');
  });

  it('does not swallow actual PostgreSQL connectivity failures', async () => {
    const query = vi.fn().mockRejectedValue(new Error('synthetic connection unavailable'));
    await expect(inspectAccountVpnSchema({ query } as unknown as Pick<Pool, 'query'>))
      .rejects.toThrow('synthetic connection unavailable');
  });

  it('never includes VPN fields in the unconditional accounts query or exposes portals during drift', () => {
    const page = readFileSync('src/app/admin/accounts/page.tsx', 'utf8');
    const base = page.split('const [accounts, production')[1]?.split('const vpnDetails')[0] ?? '';
    expect(base).toContain('secretRef: true');
    expect(base).not.toContain('vpnCountry: true');
    expect(base).not.toContain('vpnProvider: true');
    expect(page).toContain("vpnSchemaStatus === 'complete'");
    expect(page).toContain('Acceso suspendido hasta verificar la configuración VPN.');
    expect(page).toContain('<WhoerAccessGate');
  });
});
