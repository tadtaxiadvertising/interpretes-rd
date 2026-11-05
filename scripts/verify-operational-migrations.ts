import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to verify operational migrations.');
}

const migrations = [
  '20261103220000_company_directory/migration.sql',
  '20261103222000_interpreter_account_assignments/migration.sql',
  '20261103224000_company_production_reports/migration.sql',
  '20261103232000_company_report_reviews/migration.sql',
  '20261103235000_account_platforms/migration.sql',
  '20261105140000_client_directory/migration.sql',
  '20261105150000_account_names_per_client/migration.sql',
] as const;

async function main() {
  const client = new Client({ connectionString });
  await client.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // These are disposable CI database changes only. The transaction is
    // always rolled back, preserving the Prisma db-push schema for E2E tests.
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
    await client.query('ALTER TABLE public.accounts ADD CONSTRAINT accounts_name_key UNIQUE (name)');
    await client.query('DROP TABLE IF EXISTS public.companies CASCADE');
    await client.query('DROP TABLE IF EXISTS public.clients CASCADE');

    for (const migration of migrations) {
      const sql = await readFile(resolve(process.cwd(), 'prisma/migrations', migration), 'utf8');
      if (!sql.trim()) throw new Error(`Operational migration is empty: ${migration}`);
      await client.query(sql);
      console.log(`Applied in rollback-only CI transaction: ${migration}`);
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
    const legacyNameConstraint = await client.query(
      `SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.accounts'::regclass AND conname = 'accounts_name_key'`,
    );
    if (legacyNameConstraint.rowCount) {
      throw new Error('The legacy global account-name constraint was not removed.');
    }

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
