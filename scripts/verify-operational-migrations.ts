import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to verify operational migrations.');
}

const ownershipMigration = '20261105150000_account_names_per_client/migration.sql';
const fixtureIds = [-19401, -19402, -19403];

const migrations = [
  '20261103220000_company_directory/migration.sql',
  '20261103222000_interpreter_account_assignments/migration.sql',
  '20261103224000_company_production_reports/migration.sql',
  '20261103232000_company_report_reviews/migration.sql',
  '20261103235000_account_platforms/migration.sql',
  '20261105140000_client_directory/migration.sql',
  ownershipMigration,
  '20261105180000_client_directory/migration.sql',
] as const;

async function ownershipFixtureSnapshot(client: Client) {
  // Every lookup is bounded by the deterministic fixture primary keys. Include
  // whole rows so a migration cannot silently change values or relationships.
  const result = await client.query(
    `SELECT jsonb_build_object(
       'accounts', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id)
                    FROM public.accounts a WHERE a.id = ANY($1::int[])),
       'clients', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id)
                   FROM public.clients c WHERE c.id = ANY($1::int[])),
       'companies', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id)
                     FROM public.companies c WHERE c.id = ANY($1::int[])),
       'rates', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id)
                 FROM public.interpreter_account_rates r WHERE r.id = ANY($1::int[])),
       'assignments', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id)
                       FROM public.interpreter_account_assignments a WHERE a.id = ANY($1::int[])),
       'history', (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id)
                   FROM public.production_logs l WHERE l.id = ANY($1::int[])),
       'reports', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id)
                   FROM public.company_production_reports r WHERE r.id = ANY($1::int[])),
       'platforms', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id)
                     FROM public.account_platforms p WHERE p.id = ANY($1::int[]))
     ) AS snapshot`,
    [fixtureIds],
  );
  return JSON.stringify(result.rows[0].snapshot);
}

async function main() {
  const client = new Client({ connectionString });
  await client.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // These are disposable CI database changes only. The transaction is
    // always rolled back, preserving the Prisma db-push schema for E2E tests.
    // Reset only the additive Roleplay queue objects in this isolated CI
    // transaction so the actual SQL migration is exercised rather than relying
    // on Prisma db push to have created an equivalent schema.
    await client.query('DROP TABLE IF EXISTS public.roleplay_audio_jobs CASCADE');
    await client.query('DROP TYPE IF EXISTS public."RoleplayAudioJobStatus" CASCADE');

    const baseTables = await client.query(
      `SELECT to_regclass('public.accounts') AS accounts,
              to_regclass('public.interpreters') AS interpreters,
              to_regclass('public.production_logs') AS production_logs`,
    );
    if (!baseTables.rows[0]?.accounts || !baseTables.rows[0]?.interpreters ||
        !baseTables.rows[0]?.production_logs) {
      throw new Error('The isolated CI database is missing operational base tables.');
    }

    await client.query(`
      DROP TABLE IF EXISTS
        public.company_report_reviews,
        public.company_production_reports,
        public.account_platforms,
        public.interpreter_account_assignments
      CASCADE
    `);
    await client.query('ALTER TABLE public.accounts DROP COLUMN IF EXISTS company_id CASCADE');
    await client.query('ALTER TABLE public.accounts DROP COLUMN IF EXISTS client_id CASCADE');
    // Recreate the previous global-name uniqueness so the new migration is
    // tested against the exact legacy constraint it must replace.
    await client.query('ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_client_id_name_key');
    await client.query('DROP INDEX IF EXISTS public.accounts_client_id_name_key');
    await client.query('CREATE UNIQUE INDEX accounts_name_key ON public.accounts (name)');
    await client.query('DROP TABLE IF EXISTS public.companies CASCADE');
    await client.query('DROP TABLE IF EXISTS public.clients CASCADE');

    // Legacy accounts and their financial/history rows exist before either
    // ownership column. Negative IDs avoid advancing the CI database sequences.
    await client.query(`
      INSERT INTO public.interpreters (id, external_id, name, tariff_per_minute)
      VALUES (-19401, '__ci_ownership_interpreter', '__ci_ownership_interpreter', 0.25);
      INSERT INTO public.accounts (id, name, description) VALUES
        (-19401, '__ci_legacy_account_a', 'legacy client A'),
        (-19402, '__ci_legacy_account_b', 'legacy client B'),
        (-19403, '__ci_legacy_unassigned', 'ownership remains unknown');
      INSERT INTO public.interpreter_account_rates (id, interpreter_id, account_id, tariff_per_hour) VALUES
        (-19401, -19401, -19401, 11.25),
        (-19402, -19401, -19402, 22.50),
        (-19403, -19401, -19403, 33.75);
      INSERT INTO public.production_logs
        (id, interpreter_id, account_id, date, status, interpreted_minutes, calls_attended) VALUES
        (-19401, -19401, -19401, '2026-10-01', 'Manual', 101, 11),
        (-19402, -19401, -19402, '2026-10-02', 'Manual', 202, 22),
        (-19403, -19401, -19403, '2026-10-03', 'Manual', 303, 33)
    `);

    let ownershipSnapshot: string | undefined;
    let ownershipSql = '';
    for (const migration of migrations) {
      const sql = await readFile(resolve(process.cwd(), 'prisma/migrations', migration), 'utf8');
      if (!sql.trim()) throw new Error(`Operational migration is empty: ${migration}`);

      if (migration === ownershipMigration) {
        const legacyOwners = await client.query(
          `SELECT COUNT(*)::int AS unassigned FROM public.accounts
           WHERE id = ANY($1::int[]) AND client_id IS NULL AND company_id IS NULL`,
          [fixtureIds],
        );
        if (legacyOwners.rows[0]?.unassigned !== fixtureIds.length) {
          throw new Error('Directory migrations must preserve legacy account IDs without inventing ownership.');
        }
        await client.query(`
          INSERT INTO public.clients (id, name) VALUES
            (-19401, '__ci_ownership_client_a'), (-19402, '__ci_ownership_client_b');
          INSERT INTO public.companies (id, name) VALUES (-19401, '__ci_ownership_shared_company');
          UPDATE public.accounts SET client_id = id, company_id = -19401
          WHERE id IN (-19401, -19402);
          INSERT INTO public.interpreter_account_assignments
            (id, interpreter_id, account_id, starts_at, ends_at) VALUES
            (-19401, -19401, -19401, '2026-10-01', '2026-10-31'),
            (-19402, -19401, -19402, '2026-10-01', '2026-10-31'),
            (-19403, -19401, -19403, '2026-10-01', '2026-10-31');
          INSERT INTO public.company_production_reports
            (id, account_id, period_start, period_end, source_name, source_checksum, reported_minutes) VALUES
            (-19401, -19401, '2026-10-01', '2026-10-31', '__ci_report_a', '__ci_checksum_a', 101),
            (-19402, -19402, '2026-10-01', '2026-10-31', '__ci_report_b', '__ci_checksum_b', 202),
            (-19403, -19403, '2026-10-01', '2026-10-31', '__ci_report_unassigned', '__ci_checksum_c', 303);
          INSERT INTO public.account_platforms (id, account_id, name) VALUES
            (-19401, -19401, '__ci_platform'),
            (-19402, -19402, '__ci_platform'),
            (-19403, -19403, '__ci_platform')
        `);
        ownershipSnapshot = await ownershipFixtureSnapshot(client);
        ownershipSql = sql;
      }

      await client.query(sql);
      console.log(`Applied in rollback-only CI transaction: ${migration}`);
    }
    if (!ownershipSnapshot || await ownershipFixtureSnapshot(client) !== ownershipSnapshot) {
      throw new Error('Account ownership migration changed legacy IDs, ownership, rates, assignments or history.');
    }

    const expectedTables = [
      'companies',
      'interpreter_account_assignments',
      'company_production_reports',
      'company_report_reviews',
      'account_platforms',
      'clients',
    ];
    for (const table of expectedTables) {
      const result = await client.query('SELECT to_regclass($1) AS relation', [`public.${table}`]);
      if (!result.rows[0]?.relation) throw new Error(`Operational migration did not create public.${table}`);
    }

    const requiredIndexes = [
      'accounts_company_id_idx',
      'interpreter_account_assignments_account_id_starts_at_idx',
      'interpreter_account_assignments_interpreter_id_starts_at_idx',
      'company_production_reports_account_id_period_start_period_end_i',
      'reports_unique_source',
      'company_report_reviews_report_id_created_at_idx',
      'account_platforms_account_id_name_key',
      'accounts_client_id_idx',
      'accounts_client_id_name_key',
    ];
    const indexes = await client.query(
      `SELECT index_class.relname AS name
       FROM pg_class AS index_class
       JOIN pg_index AS index_meta ON index_meta.indexrelid = index_class.oid
       JOIN pg_namespace AS index_schema ON index_schema.oid = index_class.relnamespace
       WHERE index_schema.nspname = 'public'
         AND index_class.relname = ANY($1::text[])
         AND index_meta.indisvalid = true
         AND index_meta.indisready = true`,
      [requiredIndexes],
    );
    const foundIndexes = new Set(indexes.rows.map((row: { name: string }) => row.name));
    for (const indexName of requiredIndexes) {
      if (!foundIndexes.has(indexName)) throw new Error(`Operational migration index is missing: ${indexName}`);
    }

    const clientForeignKey = await client.query(
      `SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.accounts'::regclass
         AND conname = 'accounts_client_id_fkey' AND contype = 'f'`,
    );
    if (!clientForeignKey.rowCount) {
      throw new Error('Account-to-client foreign key is missing.');
    }

    // A shared company identifier must be reusable by accounts owned by different clients.
    const clientA = await client.query(
      `INSERT INTO public.clients (name) VALUES ('__ci_client_a') RETURNING id`,
    );
    const clientB = await client.query(
      `INSERT INTO public.clients (name) VALUES ('__ci_client_b') RETURNING id`,
    );
    const sharedCompany = await client.query(
      `INSERT INTO public.companies (name) VALUES ('__ci_shared_company') RETURNING id`,
    );
    await client.query(
      `INSERT INTO public.accounts (name, client_id, company_id)
       VALUES ('__ci_account_a', $1, $3), ('__ci_account_b', $2, $3)`,
      [clientA.rows[0].id, clientB.rows[0].id, sharedCompany.rows[0].id],
    );
    const ownershipCheck = await client.query(
      `SELECT COUNT(DISTINCT client_id)::int AS client_count,
              COUNT(DISTINCT company_id)::int AS company_count
       FROM public.accounts
       WHERE name IN ('__ci_account_a', '__ci_account_b')`,
    );
    if (ownershipCheck.rows[0]?.client_count !== 2 || ownershipCheck.rows[0]?.company_count !== 1) {
      throw new Error('The same company identifier must be reusable across different client-owned accounts.');
    }

    // Identical account labels are valid for different clients, but not twice
    // for the same client. Verify the database, not only application checks.
    await client.query(
      `INSERT INTO public.accounts (name, client_id)
       VALUES ('__ci_shared_account_name', $1), ('__ci_shared_account_name', $2)`,
      [clientA.rows[0].id, clientB.rows[0].id],
    );
    await client.query('SAVEPOINT duplicate_account_name');
    let duplicateRejected = false;
    try {
      await client.query(
        `INSERT INTO public.accounts (name, client_id)
         VALUES ('__ci_shared_account_name', $1)`,
        [clientA.rows[0].id],
      );
    } catch (error) {
      duplicateRejected = (error as { code?: string }).code === '23505';
      await client.query('ROLLBACK TO SAVEPOINT duplicate_account_name');
    }
    await client.query('RELEASE SAVEPOINT duplicate_account_name');
    if (!duplicateRejected) {
      throw new Error('Duplicate account names must be rejected within the same client.');
    }
    const legacyNameIndex = await client.query(
      `SELECT to_regclass('public.accounts_name_key') AS index_name`,
    );
    if (legacyNameIndex.rows[0]?.index_name) {
      throw new Error('The legacy global account-name index was not removed.');
    }

    // Reuse a legacy label across two clients, then retry the actual SQL with
    // live relationships. Neither account nor its operational data may merge.
    await client.query(`
      UPDATE public.accounts SET name = '__ci_legacy_account_a' WHERE id = -19402
    `);
    const beforeRetry = await ownershipFixtureSnapshot(client);
    await client.query(ownershipSql);
    if (await ownershipFixtureSnapshot(client) !== beforeRetry) {
      throw new Error('Retrying account ownership migration changed data for same-name accounts across clients.');
    }
    console.log('Account ownership migration preserves legacy data and is idempotent across client-scoped names.');

    const assignmentConstraint = await client.query(
      `SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.interpreter_account_assignments'::regclass
         AND conname = 'assignments_no_overlap' AND contype = 'x'`,
    );
    if (!assignmentConstraint.rowCount) {
      throw new Error('Interpreter assignment overlap exclusion constraint is missing.');
    }

    const reportConstraints = await client.query(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'public.company_production_reports'::regclass
         AND conname IN ('reports_valid_period', 'reports_nonnegative_minutes', 'reports_nonnegative_calls')`,
    );
    if (reportConstraints.rowCount !== 3) {
      throw new Error('Company report integrity constraints are incomplete.');
    }

    const rlsTables = await client.query(
      `SELECT c.relname AS name
       FROM pg_class AS c
       JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = ANY($1::text[])
         AND c.relrowsecurity = true`,
      [expectedTables],
    );
    const rlsEnabled = new Set(rlsTables.rows.map((row: { name: string }) => row.name));
    for (const table of expectedTables) {
      if (!rlsEnabled.has(table)) throw new Error(`Row-level security is not enabled on public.${table}`);
    }

    const roleplayQueueMigration = await readFile(
      resolve(process.cwd(), 'prisma/migrations/20261108143000_roleplay_audio_job_queue/migration.sql'),
      'utf8',
    );
    if (!roleplayQueueMigration.trim()) {
      throw new Error('Roleplay audio queue migration is empty.');
    }
    await client.query(roleplayQueueMigration);

    const queueTable = await client.query(
      `SELECT to_regclass('public.roleplay_audio_jobs') AS relation`,
    );
    if (!queueTable.rows[0]?.relation) {
      throw new Error('Roleplay audio queue migration did not create its table.');
    }

    const queueForeignKeys = await client.query(
      `SELECT conname
       FROM pg_constraint
       WHERE conrelid = 'public.roleplay_audio_jobs'::regclass
         AND contype = 'f'`,
    );
    const queueForeignKeyNames = new Set(queueForeignKeys.rows.map((row: { conname: string }) => row.conname));
    for (const name of [
      'roleplay_audio_jobs_session_id_fkey',
      'roleplay_audio_jobs_scenario_id_fkey',
    ]) {
      if (!queueForeignKeyNames.has(name)) {
        throw new Error(`Roleplay audio queue foreign key is missing: ${name}`);
      }
    }

    const queueIndexes = await client.query(
      `SELECT index_class.relname AS name
       FROM pg_class AS index_class
       JOIN pg_index AS index_meta ON index_meta.indexrelid = index_class.oid
       JOIN pg_namespace AS index_schema ON index_schema.oid = index_class.relnamespace
       WHERE index_schema.nspname = 'public'
         AND index_class.relname = ANY($1::text[])
         AND index_meta.indisvalid = true
         AND index_meta.indisready = true`,
      [[
        'idx_roleplay_audio_jobs_claim',
        'idx_roleplay_audio_jobs_lease',
        'idx_roleplay_audio_jobs_session',
        'idx_roleplay_audio_jobs_scenario',
      ]],
    );
    const foundQueueIndexes = new Set(queueIndexes.rows.map((row: { name: string }) => row.name));
    for (const name of [
      'idx_roleplay_audio_jobs_claim',
      'idx_roleplay_audio_jobs_lease',
      'idx_roleplay_audio_jobs_session',
      'idx_roleplay_audio_jobs_scenario',
    ]) {
      if (!foundQueueIndexes.has(name)) {
        throw new Error(`Roleplay audio queue index is missing: ${name}`);
      }
    }

    // The migration is safe to retry after an interrupted deployment.
    await client.query(roleplayQueueMigration);
    console.log('Roleplay audio queue migration creates its constraints and indexes and is idempotent in CI.');

    console.log('All operational migrations applied and verified successfully in CI.');
  } finally {
    if (transactionStarted) await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('Operational migration verification failed:', error);
  process.exitCode = 1;
});
