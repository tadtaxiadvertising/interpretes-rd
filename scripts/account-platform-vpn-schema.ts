/** Schema-only guard for repeatable, non-destructive VPN migration rollout. */
export const VPN_COLUMN_TYPES = {
  vpn_provider: 'text',
  vpn_app: 'text',
  vpn_username_hint: 'text',
  vpn_secret_ref: 'text',
  vpn_country: 'text',
  vpn_region: 'text',
  vpn_server: 'text',
  vpn_exit_ip: 'text',
  vpn_profile: 'text',
  vpn_protocol: 'text',
  vpn_port: 'integer',
} as const;

/** Match the SQL migration's actual port range expression, not merely the
 * name of a validated CHECK constraint (which could be CHECK (true)).
 * pg_get_constraintdef may add parentheses, whitespace, and identifier quotes.
 * Refuse to auto-repair any other definition, even a plausible equivalent.
 */
export function matchesVpnPortConstraint(definition: unknown): boolean {
  if (typeof definition !== 'string') return false;
  const normalized = definition.replace(/["()\s]/gu, '').toLowerCase();
  return normalized === 'checkvpn_portisnullorvpn_port>=1andvpn_port<=65535';
}

export type VpnSchemaStatus = 'missing' | 'complete' | 'partial';
export type VpnColumn = { column_name: string; data_type: string; is_nullable: string };

/**
 * Never fix partially-applied schemas automatically: even a matching name
 * with the wrong type/nullability must stop deployment for manual review.
 */
export function classifyVpnSchema(
  columns: readonly VpnColumn[],
  constraintPresent: boolean,
): VpnSchemaStatus {
  const expected = Object.entries(VPN_COLUMN_TYPES);
  const matches = new Map(columns.map(c => [c.column_name, c]));
  if (columns.length === 0 && !constraintPresent) return 'missing';
  if (columns.length === expected.length && constraintPresent &&
      expected.every(([name, type]) => {
        const column = matches.get(name);
        return column?.data_type === type && column?.is_nullable === 'YES';
      })) {
    return 'complete';
  }
  return 'partial';
}
