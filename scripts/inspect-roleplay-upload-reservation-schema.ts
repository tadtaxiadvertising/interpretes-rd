import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { normalizeDirectDatabaseUrl } from './normalize-direct-database-url';
import { createDatabasePoolConfig } from '../src/lib/database-pool-config';
import {
  classifyRoleplayReservationCatalog,
  readRoleplayReservationCatalog,
} from './roleplay-upload-reservation-schema-catalog';

/**
 * Optional operator CLI only; never imported by the runtime or automatically
 * run against Supabase from CI. No DDL, DML, repairs, credentials or user rows.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--check-only', '--require-ready'].includes(args[0])) {
    throw new Error('Specify --check-only or --require-ready.');
  }
  const requireReady = args[0] === '--require-ready';
  const direct = normalizeDirectDatabaseUrl(process.env.DIRECT_URL);
  const caPem = readFileSync(join(process.cwd(), 'certs', 'prod-ca-2021.crt'), 'utf8');
  const config = createDatabasePoolConfig(direct, caPem);
  const client = new Client({
    connectionString: config.connectionString,
    ssl: config.ssl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000,
    query_timeout: 10_000,
    application_name: 'interpretes-roleplay-upload-reservation-readonly',
  });
  client.on('error', () => undefined);
  let inTransaction = false;
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    inTransaction = true;
    const catalog = await readRoleplayReservationCatalog(client);
    await client.query('ROLLBACK');
    inTransaction = false;
    const status = classifyRoleplayReservationCatalog(catalog);
    console.log('Roleplay upload reservation catalog status: ' + status + '.');
    console.log('Catalog-only check; NOT approval to sign uploads or apply migrations.');
    if (status === 'incomplete' || (requireReady && status !== 'catalog-ready')) {
      process.exitCode = 1;
    }
  } finally {
    if (inTransaction) await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

void main().catch(() => {
  // Provider errors can include credentials, SQL and user identifiers.
  console.error('Read-only Roleplay reservation catalog inspection failed.');
  process.exitCode = 1;
});
