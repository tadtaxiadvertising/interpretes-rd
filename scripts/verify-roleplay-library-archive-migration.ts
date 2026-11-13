import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

/**
 * Test the additive library visibility migration against CI's isolated database.
 * Everything (including DROP/CREATE) is rolled back; no production URL is used.
 */
async function main() {
  if (!process.env.DATABASE_URL || process.env.NODE_ENV === 'production') {
    throw new Error('Isolated CI DATABASE_URL is required; production is forbidden.');
  }
  if (!/localhost|127\.0\.0\.1/.test(new URL(process.env.DATABASE_URL).hostname)) {
    throw new Error('Roleplay archive migration test requires localhost PostgreSQL.');
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('DROP TABLE IF EXISTS public.roleplay_library_archives');
    const migration = await readFile(
      'prisma/migrations/20261112220000_roleplay_library_archives/migration.sql',
      'utf8',
    );
    await client.query(migration);
    await client.query(migration); // Re-running the migration must be harmless.

    const configuration = await client.query<{ rls: boolean; object_exists: boolean }>(`
      SELECT relrowsecurity AS rls, TRUE AS object_exists
      FROM pg_class WHERE oid = 'public.roleplay_library_archives'::regclass
    `);
    if (!configuration.rows[0]?.object_exists || !configuration.rows[0]?.rls) {
      throw new Error('Roleplay library archive table must exist with RLS enabled.');
    }
    const fingerprint = 'a'.repeat(64);
    await client.query(
      'INSERT INTO public.roleplay_library_archives (fingerprint, archived_at, archived_by) VALUES ($1, NOW(), $2)',
      [fingerprint, 'ci-admin'],
    );
    const result = await client.query<{ archived: boolean; actor: string }>(
      'SELECT archived_at IS NOT NULL AS archived, archived_by AS actor FROM public.roleplay_library_archives WHERE fingerprint=$1',
      [fingerprint],
    );
    if (!result.rows[0]?.archived || result.rows[0]?.actor !== 'ci-admin') {
      throw new Error('Archive insert failed.');
    }
    await client.query('UPDATE public.roleplay_library_archives SET archived_at=NULL WHERE fingerprint=$1', [fingerprint]);
    const restored = await client.query<{ visible: boolean }>(
      'SELECT archived_at IS NULL AS visible FROM public.roleplay_library_archives WHERE fingerprint=$1',
      [fingerprint],
    );
    if (!restored.rows[0]?.visible) throw new Error('Archive restore failed.');
    console.log('Isolated archive migration and reversible visibility check passed.');
  } finally {
    try { await client.query('ROLLBACK'); } finally { await client.end(); }
  }
}

main().catch(() => {
  console.error('Isolated roleplay archive migration verification failed.');
  process.exitCode = 1;
});
