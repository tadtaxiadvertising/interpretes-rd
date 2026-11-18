import 'dotenv/config';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { normalizeDirectDatabaseUrl } from './normalize-direct-database-url';
import { createDatabasePoolConfig } from '../src/lib/database-pool-config';
import {
  classifyCallKeySchema,
  type CallKeyCatalog,
  type CatalogColumn,
  type CatalogConstraint,
} from './call-idempotency-schema-state';

/**
 * Intentionally run ONLY upon an explicit operator request. Uses catalog
 * SELECTs in BEGIN READ ONLY; no DDL/DML, migration resolve, passwords,
 * connection URLs, user records or unredacted PostgreSQL errors in output.
 */
async function inspectSchema(client: Client): Promise<CallKeyCatalog> {
  const table = await client.query<{ rls_enabled: boolean }>(
    `SELECT relrowsecurity AS rls_enabled
     FROM pg_class WHERE oid = to_regclass('public.call_submission_keys')`,
  );
  const tableExists = table.rowCount === 1;
  const columns = tableExists ? await client.query<CatalogColumn>(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'call_submission_keys'`,
  ) : { rows: [] as CatalogColumn[] };
  const constraints = tableExists ? await client.query<CatalogConstraint>(
    `SELECT c.conname, c.contype, c.convalidated,
       ARRAY(
         SELECT a.attname
         FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
         JOIN pg_attribute AS a
           ON a.attrelid = c.conrelid AND a.attnum = k.attnum
         ORDER BY k.ord
       ) AS key_columns,
       rns.nspname AS references_schema,
       referenced.relname AS references_table,
       ARRAY(
         SELECT a.attname
         FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
         JOIN pg_attribute AS a
           ON a.attrelid = c.confrelid AND a.attnum = k.attnum
         ORDER BY k.ord
       ) AS references_columns,
       c.confdeltype AS on_delete,
       c.confupdtype AS on_update,
       pg_get_constraintdef(c.oid) AS definition
     FROM pg_constraint AS c
     LEFT JOIN pg_class AS referenced ON referenced.oid = c.confrelid
     LEFT JOIN pg_namespace AS rns ON rns.oid = referenced.relnamespace
     WHERE c.conrelid = to_regclass('public.call_submission_keys')`,
  ) : { rows: [] as CatalogConstraint[] };

  const index = await client.query<{ valid: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM pg_index AS i
       WHERE i.indexrelid = to_regclass('public.ux_call_sessions_id_interpreter_for_idempotency')
         AND i.indrelid = to_regclass('public.call_sessions')
         AND i.indisunique AND i.indisvalid AND i.indisready
         AND i.indnkeyatts = 2
         AND i.indkey[0] = (
           SELECT attnum FROM pg_attribute
           WHERE attrelid = to_regclass('public.call_sessions') AND attname = 'id'
         )
         AND i.indkey[1] = (
           SELECT attnum FROM pg_attribute
           WHERE attrelid = to_regclass('public.call_sessions') AND attname = 'interpreter_id'
         )
     ) AS valid`,
  );

  // A past Prisma migrate deploy may have run the old staged filenames.
  // This is not a claim about their presence or absence on any live server.
  const historyTable = await client.query<{ exists: boolean }>(
    "SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS exists",
  );
  const migrationRecords = historyTable.rows[0]?.exists ?
    await client.query<{
      migration_name: string; succeeded: boolean; rolled_back: boolean;
    }>(
      `SELECT migration_name,
         finished_at IS NOT NULL AS succeeded,
         rolled_back_at IS NOT NULL AS rolled_back
       FROM public._prisma_migrations
       WHERE migration_name = ANY($1::text[])`,
      [[
        '20261118200000_call_submission_idempotency',
        '20261118213000_call_submission_session_ownership',
      ]],
    ) : { rows: [] as CallKeyCatalog['migrationRecords'] };

  return {
    tableExists,
    rlsEnabled: table.rows[0]?.rls_enabled === true,
    columns: columns.rows,
    constraints: constraints.rows,
    supportingIndexValid: index.rows[0]?.valid === true,
    migrationRecords: migrationRecords.rows,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--check-only', '--require-complete'].includes(args[0])) {
    throw new Error('Choose --check-only or --require-complete explicitly.');
  }
  const requireComplete = args[0] === '--require-complete';
  const connectionString = normalizeDirectDatabaseUrl(process.env.DIRECT_URL);
  const caPem = readFileSync(join(process.cwd(), 'certs', 'prod-ca-2021.crt'), 'utf8');
  const config = createDatabasePoolConfig(connectionString, caPem);
  const client = new Client({
    connectionString: config.connectionString,
    ssl: config.ssl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000,
    query_timeout: 10_000,
    application_name: 'interpreters-call-idempotency-catalog-readonly',
  });
  client.on('error', () => undefined);
  let inTransaction = false;
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    inTransaction = true;
    const catalog = await inspectSchema(client);
    await client.query('ROLLBACK');
    inTransaction = false;
    const state = classifyCallKeySchema(catalog);
    const historySeen = catalog.migrationRecords.length > 0;
    console.log(`Idempotency catalog status: ${state}.`);
    console.log(historySeen
      ? 'Historical Prisma migration entries exist; manual DBA review required.'
      : 'No matching historical Prisma migration entries found.');
    if (state === 'partial' || state === 'history-drift' ||
        (requireComplete && state !== 'complete')) {
      process.exitCode = 1;
    }
  } finally {
    if (inTransaction) await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

void main().catch(() => {
  // Database driver errors may contain credentials, SQL, identifiers or PII.
  // Never log the raw error, cause, connection URL or query parameters.
  console.error('Read-only call idempotency schema inspection failed.');
  process.exitCode = 1;
});
