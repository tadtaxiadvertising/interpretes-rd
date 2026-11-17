import { describe, expect, it } from 'vitest';
import { classifyVpnSchema, matchesVpnPortConstraint, VPN_COLUMN_TYPES } from './account-platform-vpn-schema';

const validColumns = Object.entries(VPN_COLUMN_TYPES).map(([column_name, data_type]) => ({
  column_name, data_type, is_nullable: 'YES',
}));

describe('repeatable account-platform VPN migration guard', () => {
  it('allows initial migration only when every expected column is absent', () => {
    expect(classifyVpnSchema([], false)).toBe('missing');
    expect(classifyVpnSchema([], true)).toBe('partial');
  });

  it('skips a second deployment when all columns and constraint are complete', () => {
    expect(classifyVpnSchema(validColumns, true)).toBe('complete');
    expect(classifyVpnSchema([...validColumns].reverse(), true)).toBe('complete');
  });

  it('rejects partial migrations and inconsistent column types/nullability', () => {
    expect(classifyVpnSchema(validColumns.slice(0, -1), false)).toBe('partial');
    expect(classifyVpnSchema(validColumns, false)).toBe('partial');
    expect(classifyVpnSchema(validColumns.map(c =>
      c.column_name === 'vpn_port' ? { ...c, data_type: 'text' } : c), true)).toBe('partial');
    expect(classifyVpnSchema(validColumns.map(c =>
      c.column_name === 'vpn_country' ? { ...c, is_nullable: 'NO' } : c), true)).toBe('partial');
    expect(classifyVpnSchema([...validColumns, {
      column_name: 'vpn_unexpected', data_type: 'text', is_nullable: 'YES',
    }], true)).toBe('partial');
  });
  it('validates the actual port CHECK expression rather than trusting its name', () => {
    expect(matchesVpnPortConstraint(
      'CHECK (((vpn_port IS NULL) OR ((vpn_port >= 1) AND (vpn_port <= 65535))))',
    )).toBe(true);
    expect(matchesVpnPortConstraint('CHECK (true)')).toBe(false);
    expect(matchesVpnPortConstraint('CHECK (vpn_port >= 0)')).toBe(false);
    expect(matchesVpnPortConstraint(null)).toBe(false);
  });

});
