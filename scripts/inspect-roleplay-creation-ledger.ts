import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { normalizeDirectDatabaseUrl } from './normalize-direct-database-url';
import { createDatabasePoolConfig } from '../src/lib/database-pool-config';
import { classifyCreationLedgerCatalog, readCreationLedgerCatalog } from './roleplay-creation-ledger-catalog';
import { readCreationPilotConfig } from '../src/lib/roleplay/creation-pilot-config';

/** Optional operator diagnostic; never automatically called by the runtime. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--config-only', '--check-only', '--require-hardened'].includes(args[0])) {
    throw new Error('Choose --config-only, --check-only or --require-hardened.');
  }
  const pilot = readCreationPilotConfig(process.env);
  console.log('Roleplay creation pilot configuration: ' + pilot.mode + '.');
  if (pilot.mode === 'blocked-missing-receipts') {
    console.log('Keyed creation is blocked because receipt recovery is disabled.');
    process.exitCode = 1;
  }
  // Configuration diagnosis must work even when no database is available.
  if (args[0] === '--config-only') {
    console.log('Configuration only; database readiness not checked.');
    return;
  }
  const direct = normalizeDirectDatabaseUrl(process.env.DIRECT_URL);
  const ca = readFileSync(join(process.cwd(), 'certs', 'prod-ca-2021.crt'), 'utf8');
  const config = createDatabasePoolConfig(direct, ca);
  const client = new Client({
    connectionString: config.connectionString,
    ssl: config.ssl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000,
    query_timeout: 10_000,
    application_name: 'interpretes-roleplay-creation-ledger-readonly',
  });
  client.on('error', () => undefined);
  let transaction = false;
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transaction = true;
    const state = classifyCreationLedgerCatalog(await readCreationLedgerCatalog(client));
    await client.query('ROLLBACK');
    transaction = false;
    console.log('Roleplay creation ledger catalog: ' + state + '.');
    console.log('Catalog only; not proof of production readiness or authorization to activate.');
    if (state === 'incomplete' || (args[0] === '--require-hardened' && state !== 'hardened-catalog')) {
      process.exitCode = 1;
    }
  } finally {
    if (transaction) await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

void main().catch(() => {
  console.error('Read-only Roleplay creation ledger inspection failed.');
  process.exitCode = 1;
});
