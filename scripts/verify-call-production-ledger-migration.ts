import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to verify the call production ledger migration.');
}

async function main() {
  const client = new Client({ connectionString });
  await client.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // CI points DATABASE_URL at its disposable PostgreSQL service. Replaying
    // the real migration inside a transaction validates SQL without keeping
    // schema changes or touching any shared database.
    await client.query('DROP TABLE IF EXISTS public.call_production_entries CASCADE');

    const migration = await readFile(
      resolve(process.cwd(), 'prisma/migrations/20261111090000_call_production_ledger/migration.sql'),
      'utf8',
    );
    if (!migration.trim()) {
      throw new Error('Call production ledger migration is empty.');
    }
    await client.query(migration);

    const table = await client.query(
      `SELECT c.relrowsecurity AS rls_enabled
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'call_production_entries'`,
    );
    if (table.rowCount !== 1 || table.rows[0].rls_enabled !== true) {
      throw new Error('Call production ledger table is missing or RLS is disabled.');
    }

    const constraints = await client.query(
      `SELECT conname, contype
       FROM pg_constraint
       WHERE conrelid = 'public.call_production_entries'::regclass`,
    );
    const constraintTypes = new Map<string, string>(
      constraints.rows.map((row: { conname: string; contype: string }) => [row.conname, row.contype]),
    );
    for (const [name, expectedType] of [
      ['call_production_entries_pkey', 'p'],
      ['call_production_entries_nonnegative_minutes', 'c'],
      ['call_production_entries_nonnegative_calls', 'c'],
    ]) {
      if (constraintTypes.get(name) !== expectedType) {
        throw new Error(`Missing or invalid ledger constraint: ${name}`);
      }
    }

    const indexes = await client.query(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'call_production_entries'`,
    );
    const indexNames = new Set<string>(
      indexes.rows.map((row: { indexname: string }) => row.indexname),
    );
    for (const name of [
      'idx_call_production_entries_interpreter_date',
      'idx_call_production_entries_production_log',
    ]) {
      if (!indexNames.has(name)) {
        throw new Error(`Missing call production ledger index: ${name}`);
      }
    }

    const rows = await client.query(
      'SELECT COUNT(*)::int AS count FROM public.call_production_entries',
    );
    if (rows.rows[0]?.count !== 0) {
      throw new Error('Ledger migration unexpectedly inserted historical rows.');
    }

    console.log(
      'Call production ledger migration verified: table, RLS, constraints, indexes, and no historical backfill.',
    );
  } finally {
    if (transactionStarted) await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('Call production ledger migration verification failed:', error);
  process.exitCode = 1;
});
