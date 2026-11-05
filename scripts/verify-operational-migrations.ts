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
        public.interpreter_account_assignments,
        public.clients
      CASCADE
    `);
    await client.query('ALTER TABLE public.accounts DROP COLUMN IF EXISTS company_id CASCADE');
    await client.query('ALTER TABLE public.accounts DROP COLUMN IF EXISTS client_id CASCADE');
    await client.query('DROP TABLE IF EXISTS public.companies CASCADE');

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
