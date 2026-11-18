import 'dotenv/config';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { normalizeDirectDatabaseUrl } from './normalize-direct-database-url';
import { createDatabasePoolConfig } from '../src/lib/database-pool-config';
import { classifyCallKeySchema } from './call-idempotency-schema-state';
import { readCallKeyCatalog } from './call-idempotency-schema-catalog';

/**
 * Intentionally run ONLY upon an explicit operator request. Uses catalog
 * SELECTs in BEGIN READ ONLY; no DDL/DML, migration resolve, passwords,
 * connection URLs, user records or unredacted PostgreSQL errors in output.
 */

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
    const catalog = await readCallKeyCatalog(client);
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
