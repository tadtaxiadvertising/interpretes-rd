import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { normalizeDirectDatabaseUrl } from './normalize-direct-database-url';
import { createDatabasePoolConfig } from '../src/lib/database-pool-config';

// Operator-invoked inventory only. No paths, credentials, user identifiers,
// Storage mutations, DDL or application data changes are emitted.
async function main() {
  if (process.argv.slice(2).join(' ') !== '--check-only') throw new Error('Specify --check-only.');
  const direct = normalizeDirectDatabaseUrl(process.env.DIRECT_URL);
  const caPem = readFileSync(join(process.cwd(), 'certs', 'prod-ca-2021.crt'), 'utf8');
  const config = createDatabasePoolConfig(direct, caPem);
  const client = new Client({
    connectionString: config.connectionString, ssl: config.ssl,
    connectionTimeoutMillis: 10_000, statement_timeout: 10_000, query_timeout: 10_000,
    application_name: 'interpretes-opening-retired-readonly',
  });
  client.on('error', () => undefined);
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const result = await client.query(`
      SELECT count(*)::text AS total,
        count(*) FILTER (WHERE r.cleanup_permitted AND r.cleanup_after <= CURRENT_TIMESTAMP
          AND NOT EXISTS (SELECT 1 FROM public.roleplay_bilingual_openings o WHERE o.source_audio_path = r.source_audio_path)
          AND NOT EXISTS (SELECT 1 FROM public.roleplay_bilingual_opening_reservations p WHERE p.source_audio_path = r.source_audio_path)
        )::text AS eligible
      FROM public.roleplay_bilingual_opening_retired_paths r
    `);
    await client.query('ROLLBACK');
    console.log('Retired opening keys: ' + result.rows[0].total);
    console.log('Past grace period and unreferenced: ' + result.rows[0].eligible);
    console.log('Inventory only; eligibility is not permission to delete Storage objects.');
  } finally {
    await client.end();
  }
}
void main().catch(() => {
  console.error('Opening retirement inventory unavailable.');
  process.exitCode = 1;
});
