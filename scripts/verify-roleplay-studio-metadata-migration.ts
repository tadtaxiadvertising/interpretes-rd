import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

const MIGRATION = 'prisma/migrations/20261114233000_roleplay_studio_turn_metadata/migration.sql';
const columns = [
  ['studio_turn', 'integer'],
  ['studio_speaker', 'text'],
  ['studio_language', 'text'],
  ['source_start_sec', 'double precision'],
  ['source_end_sec', 'double precision'],
] as const;
const constraints = [
  'roleplay_scenarios_studio_turn_positive',
  'roleplay_scenarios_studio_speaker_valid',
  'roleplay_scenarios_studio_language_valid',
  'roleplay_scenarios_source_time_pair_valid',
] as const;

/** Run only against CI's disposable local PostgreSQL. All changes roll back. */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || process.env.NODE_ENV === 'production' ||
      process.env.E2E_ALLOW_RUN !== 'true' ||
      !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
    throw new Error('Studio metadata migration verification requires explicitly enabled isolated localhost PostgreSQL.');
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    // Simulate the pre-migration table in the isolated CI database. The
    // rollback restores the exact original schema before this verification.
    await client.query(`
      ALTER TABLE public.roleplay_scenarios
        DROP COLUMN IF EXISTS studio_turn,
        DROP COLUMN IF EXISTS studio_speaker,
        DROP COLUMN IF EXISTS studio_language,
        DROP COLUMN IF EXISTS source_start_sec,
        DROP COLUMN IF EXISTS source_end_sec
    `);

    const sql = await readFile(MIGRATION, 'utf8');
    await client.query(sql);
    await client.query(sql); // Required: production migration runner replays SQL on each deploy.

    const foundColumns = await client.query<{ column_name: string; data_type: string; is_nullable: string }>(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'roleplay_scenarios'
        AND column_name IN ('studio_turn', 'studio_speaker', 'studio_language', 'source_start_sec', 'source_end_sec')
    `);
    for (const [column, type] of columns) {
      const metadata = foundColumns.rows.find((row) => row.column_name === column);
      if (!metadata || metadata.data_type !== type || metadata.is_nullable !== 'YES') {
        throw new Error(`Invalid Studio metadata column: ${column}`);
      }
    }
    const foundConstraints = await client.query<{ conname: string; convalidated: boolean; definition: string }>(`
      SELECT conname, convalidated, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'public.roleplay_scenarios'::regclass
        AND conname IN (
          'roleplay_scenarios_studio_turn_positive',
          'roleplay_scenarios_studio_speaker_valid',
          'roleplay_scenarios_studio_language_valid',
          'roleplay_scenarios_source_time_pair_valid'
        )
    `);
    for (const name of constraints) {
      const item = foundConstraints.rows.find((row) => row.conname === name);
      if (!item?.convalidated || !item.definition.startsWith('CHECK')) {
        throw new Error(`Missing or unvalidated Studio metadata constraint: ${name}`);
      }
    }
    console.log('Isolated Studio metadata migration verified, including safe repeated application.');
  } finally {
    try { await client.query('ROLLBACK'); } finally { await client.end(); }
  }
}

main().catch(() => {
  console.error('Isolated Studio metadata migration verification failed.');
  process.exitCode = 1;
});
