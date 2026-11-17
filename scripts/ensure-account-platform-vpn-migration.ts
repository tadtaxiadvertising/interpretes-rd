import 'dotenv/config';

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { normalizeDirectDatabaseUrl } from './normalize-direct-database-url';
import { createDatabasePoolConfig } from '../src/lib/database-pool-config';
import { classifyVpnSchema, matchesVpnPortConstraint, VPN_COLUMN_TYPES } from './account-platform-vpn-schema';

/**
 * Deploy-only, repeatable migration guard. Existing complete schemas are
 * a no-op; pristine schemas execute the original migration transactionally.
 * Partial or incompatible schemas fail closed, without trying to "repair" them.
 */
async function readSchemaState(client: Client) {
  const table = await client.query("SELECT to_regclass('public.account_platforms') AS relation");
  if (!table.rows[0]?.relation) throw new Error('account_platforms table is missing');

  const columns = await client.query(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'account_platforms'
       AND column_name = ANY($1::text[])`,
    [Object.keys(VPN_COLUMN_TYPES)],
  );
  const constraint = await client.query<{ definition: string }>(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
     WHERE conrelid = 'public.account_platforms'::regclass
       AND conname = 'account_platforms_vpn_port_range'
       AND contype = 'c' AND convalidated`,
  );
  // A CHECK (true) with the right name is NOT the port-range guarantee.
  const validConstraint = constraint.rows.length === 1 &&
    matchesVpnPortConstraint(constraint.rows[0]?.definition);
  return classifyVpnSchema(columns.rows, validConstraint);
}

async function main() {
  const root = process.cwd();
  const sqlFile = resolve(root, 'prisma/migrations/20261117130000_account_platform_vpn_config/migration.sql');
  const sql = await readFile(sqlFile, 'utf8');
  if (!sql.trim()) throw new Error('VPN migration SQL is empty');

  const dbUrl = normalizeDirectDatabaseUrl(process.env.DIRECT_URL);
  const ca = readFileSync(join(root, 'certs', 'prod-ca-2021.crt'), 'utf8');
  const client = new Client(createDatabasePoolConfig(dbUrl, ca));

  let connected = false;
  let inTransaction = false;
  try {
    await client.connect();
    connected = true;
    await client.query('BEGIN');
    inTransaction = true;

    // Matches the lock used by scripts/run-migration.ts to prevent races.
    await client.query('SELECT pg_advisory_xact_lock(194, 20261105)');
    const state = await readSchemaState(client);
    // A completed migration recorded in Prisma history with no matching
    // schema signals drift. Do not silently replay it or rewrite history.
    const historyTable = await client.query(
      "SELECT to_regclass('public._prisma_migrations') AS relation",
    );
    if (historyTable.rows[0]?.relation && state === 'missing') {
      const history = await client.query(
        `SELECT finished_at FROM public._prisma_migrations
         WHERE migration_name = $1 AND rolled_back_at IS NULL
         ORDER BY started_at DESC LIMIT 1`,
        ['20261117130000_account_platform_vpn_config'],
      );
      if (history.rows[0]?.finished_at) {
        throw new Error('VPN migration history contradicts the live schema');
      }
    }
    if (state === 'partial') {
      throw new Error('VPN migration schema is partially applied or incompatible');
    }
    if (state === 'missing') {
      await client.query(sql);
      if ((await readSchemaState(client)) !== 'complete') {
        throw new Error('VPN migration postcondition failed');
      }
    }
    await client.query('COMMIT');
    inTransaction = false;
    console.log(state === 'missing'
      ? 'Account VPN schema migration applied and verified.'
      : 'Account VPN schema already complete; no migration needed.');
  } catch {
    if (inTransaction) await client.query('ROLLBACK').catch(() => undefined);
    // Never emit raw PostgreSQL errors: they may contain SQL and connection data.
    console.error('Account VPN migration verification failed; transaction was not committed.');
    process.exitCode = 1;
  } finally {
    if (connected) await client.end().catch(() => undefined);
  }
}

void main().catch(() => {
  console.error('Account VPN migration setup failed.');
  process.exitCode = 1;
});
