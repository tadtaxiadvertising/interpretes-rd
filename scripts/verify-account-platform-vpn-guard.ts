import 'dotenv/config';

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Client } from 'pg';

/**
 * Exercise the EXACT production migration entrypoint on disposable localhost
 * PostgreSQL. This script is forbidden in production and never touches a
 * pre-existing account_platforms table. The database is dropped by CI.
 */
async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw || process.env.CI !== 'true' || process.env.NODE_ENV === 'production') {
    throw new Error('Isolated CI only: DATABASE_URL and CI=true are required.');
  }
  const url = new URL(raw);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.pathname !== '/interpreters_e2e' || !['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Refusing to run migration verification outside the isolated E2E database.');
  }

  const client = new Client({ connectionString: raw });
  await client.connect();
  let created = false;
  const runGuard = (
    expectSuccess: boolean,
    scenario: string,
    mode?: '--check-only' | '--require-complete',
  ) => {
    const executed = spawnSync(
      resolve(process.cwd(), 'node_modules/.bin/tsx'),
      ['scripts/ensure-account-platform-vpn-migration.ts', ...(mode ? [mode] : [])],
      { cwd: process.cwd(), timeout: 45_000, encoding: 'utf8',
        env: { ...process.env, DIRECT_URL: raw } },
    );
    if (executed.error || (executed.status === 0) !== expectSuccess) {
      // Do not print subprocess output; database driver logs can contain
      // connection strings. Only use the deterministic scenario label.
      throw new Error('Unexpected VPN migration result: ' + scenario);
    }
  };

  try {
    const existing = await client.query(
      "SELECT to_regclass('public.account_platforms') IS NOT NULL AS present",
    );
    if (existing.rows[0]?.present) {
      throw new Error('The isolated database already contains account_platforms; refusing to touch it.');
    }
    await client.query('CREATE TABLE public.account_platforms (id integer PRIMARY KEY)');
    created = true;
    runGuard(true, 'read-only inspection of missing VPN schema', '--check-only');
    const pristine = await client.query(
      `SELECT COUNT(*)::int AS total FROM information_schema.columns
       WHERE table_schema='public' AND table_name='account_platforms'
       AND column_name LIKE 'vpn_%'`,
    );
    if (pristine.rows[0]?.total !== 0) {
      throw new Error('Read-only inspection unexpectedly changed the VPN schema');
    }
    runGuard(false, 'strict completeness check on missing schema', '--require-complete');
    runGuard(true, 'first deployment');
    runGuard(true, 'strict completeness check on migrated schema', '--require-complete');

    const count = await client.query(
      `SELECT count(*)::int AS total FROM information_schema.columns
       WHERE table_schema='public' AND table_name='account_platforms'
       AND column_name LIKE 'vpn_%'`,
    );
    if (count.rows[0]?.total !== 11) throw new Error('VPN schema did not include all 11 columns');
    runGuard(true, 'second deployment (idempotent)');

    // A genuinely partial schema must stop without trying any new DDL.
    await client.query('ALTER TABLE public.account_platforms DROP COLUMN vpn_provider');
    runGuard(false, 'partially applied schema');
    runGuard(false, 'partial schema in read-only inspection', '--check-only');
    runGuard(false, 'partial schema in strict completeness check', '--require-complete');
    const stillMissing = await client.query(
      `SELECT count(*)::int AS total FROM information_schema.columns
       WHERE table_schema='public' AND table_name='account_platforms'
       AND column_name='vpn_provider'`,
    );
    if (stillMissing.rows[0]?.total !== 0) {
      throw new Error('The guard unexpectedly repaired a partial schema');
    }

    // A forged CHECK of the right name must NOT count as a valid port range.
    await client.query('ALTER TABLE public.account_platforms ADD COLUMN vpn_provider TEXT');
    await client.query('ALTER TABLE public.account_platforms DROP CONSTRAINT account_platforms_vpn_port_range');
    await client.query('ALTER TABLE public.account_platforms ADD CONSTRAINT account_platforms_vpn_port_range CHECK (true)');
    runGuard(false, 'counterfeit port CHECK');
    runGuard(false, 'counterfeit port CHECK in read-only inspection', '--check-only');
    console.log('VPN migration verified against isolated PostgreSQL: first, repeat, partial and counterfeit CHECK.');
  } finally {
    if (created) {
      // Only the disposable local CI table created by this invocation.
      await client.query('DROP TABLE IF EXISTS public.account_platforms');
    }
    await client.end();
  }
}

void main().catch(() => {
  console.error('Isolated VPN migration integration verification failed.');
  process.exitCode = 1;
});
