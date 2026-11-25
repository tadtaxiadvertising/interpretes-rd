import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { normalizeDirectDatabaseUrl } from './normalize-direct-database-url';
import { createDatabasePoolConfig } from '../src/lib/database-pool-config';
import { requireBilingualOpeningBucket } from '../src/lib/roleplay/bilingual-opening-bucket';
import { BILINGUAL_OPENING_BUCKET } from '../src/lib/roleplay/bilingual-opening';
import { cleanRetiredOpeningBatch, matchesHostedOpeningProject, type RetiredOpening } from './roleplay-opening-retired-cleanup';

// Read Storage metadata only through PostgreSQL. Delete exclusively through
// the Storage API. Keep retirement tombstones permanently to prevent reuse.
const eligible = `
  r.cleanup_permitted AND r.cleanup_after <= clock_timestamp()
  AND NOT EXISTS (SELECT 1 FROM public.roleplay_bilingual_openings o WHERE o.source_audio_path = r.source_audio_path)
  AND NOT EXISTS (SELECT 1 FROM public.roleplay_bilingual_opening_reservations p WHERE p.source_audio_path = r.source_audio_path)
  AND EXISTS (SELECT 1 FROM storage.objects obj WHERE obj.bucket_id = $1 AND obj.name = r.source_audio_path)
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--check-only', '--apply'].includes(args[0])) throw new Error('Specify --check-only or --apply.');
  const apply = args[0] === '--apply';
  const direct = normalizeDirectDatabaseUrl(process.env.DIRECT_URL);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !matchesHostedOpeningProject(url, direct)) throw new Error('Storage and database project mismatch.');
  const caPem = readFileSync(join(process.cwd(), 'certs', 'prod-ca-2021.crt'), 'utf8');
  const config = createDatabasePoolConfig(direct, caPem);
  const client = new Client({
    connectionString: config.connectionString, ssl: config.ssl,
    connectionTimeoutMillis: 10_000, statement_timeout: 10_000, query_timeout: 10_000,
    application_name: 'interpretes-opening-retired-cleanup',
  });
  let connectionLost = false;
  client.on('error', () => { connectionLost = true; });
  const storage = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }) },
  }).storage;
  try {
    await client.connect();
    // Direct or session-mode connections only: lock is scoped to this connection.
    const lock = await client.query("SELECT pg_try_advisory_lock(hashtextextended('roleplay:opening:retired-cleanup', 0)) AS acquired");
    if (lock.rows[0]?.acquired !== true) throw new Error('Cleanup already running');
    await requireBilingualOpeningBucket(storage);
    const result = await cleanRetiredOpeningBatch({
      async candidates(limit) {
        const rows = await client.query<RetiredOpening>(`
          SELECT r.source_audio_path AS path, r.session_id AS "sessionId"
          FROM public.roleplay_bilingual_opening_retired_paths r
          WHERE ${eligible} ORDER BY r.cleanup_after, r.source_audio_path LIMIT $2
        `, [BILINGUAL_OPENING_BUCKET, limit]);
        return rows.rows;
      },
      async stillEligible(row) {
        const result = await client.query(`
          SELECT EXISTS (SELECT 1 FROM public.roleplay_bilingual_opening_retired_paths r
          WHERE ${eligible} AND r.source_audio_path = $2 AND r.session_id = $3) AS eligible
        `, [BILINGUAL_OPENING_BUCKET, row.path, row.sessionId]);
        return result.rows[0]?.eligible === true;
      },
      async remove(path) {
        await requireBilingualOpeningBucket(storage);
        if (connectionLost) throw new Error('Cleanup lock lost');
        const result = await storage.from(BILINGUAL_OPENING_BUCKET).remove([path]);
        if (result.error || !Array.isArray(result.data)) throw new Error('Storage deletion uncertain');
      },
      async absent(path) {
        const result = await client.query(`
          SELECT NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = $1 AND name = $2) AS absent
        `, [BILINGUAL_OPENING_BUCKET, path]);
        return result.rows[0]?.absent === true;
      },
    }, apply);
    console.log((apply ? 'Cleanup' : 'Preview') + ': ' + JSON.stringify(result));
  } finally {
    await client.end();
  }
}

void main().catch(() => {
  console.error('Opening cleanup stopped. Recheck inventory before another run; some objects may already have been removed.');
  process.exitCode = 1;
});
