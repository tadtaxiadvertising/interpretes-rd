import 'server-only';

import type { Pool } from 'pg';
import {
  classifyVpnSchema,
  matchesVpnPortConstraint,
  VPN_COLUMN_TYPES,
  type VpnSchemaStatus,
} from '../../scripts/account-platform-vpn-schema';

/**
 * Read-only schema capability check. Prisma's generated AccountPlatform type
 * can be ahead of the production database while a safe deployment is blocked.
 * Do not fetch ANY VPN fields until the complete additive schema is present.
 */
export async function inspectAccountVpnSchema(
  pool: Pick<Pool, 'query'>,
): Promise<VpnSchemaStatus> {
  const [columns, constraint] = await Promise.all([
    pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'account_platforms'
         AND column_name = ANY($1::text[])`,
      [Object.keys(VPN_COLUMN_TYPES)],
    ),
    pool.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = to_regclass('public.account_platforms')
         AND conname = 'account_platforms_vpn_port_range'
         AND contype = 'c' AND convalidated`,
    ),
  ]);
  const validPortConstraint = constraint.rows.length === 1 &&
    matchesVpnPortConstraint(constraint.rows[0]?.definition);
  return classifyVpnSchema(columns.rows, validPortConstraint);
}
