import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to verify critical SQL migrations.');
}

const pool = new Pool({ connectionString });

async function main() {
  try {
    // Simulate the legacy production CHECK that caused SQLSTATE 23514.
    // Prisma db push does not model this hand-written CHECK constraint.
    await pool.query(`
      ALTER TABLE public.roleplay_sessions
      ADD CONSTRAINT roleplay_session_xor_subject
      CHECK (
        ((interpreter_id IS NOT NULL)::integer
          + (recruitment_candidate_id IS NOT NULL)::integer) = 1
      )
    `);

    const migrations = [
      '20261101_archive_unreviewed_legal_seed/migration.sql',
      '20261101_legal_agreement_review_gate/migration.sql',
      '20261101_legal_review_fingerprint/migration.sql',
      '20261102_legal_agreement_rls/migration.sql',
      '20261101_roleplay_orphaned_history_check/migration.sql',
    ];

    for (const migration of migrations) {
      const sql = await readFile(
        resolve(process.cwd(), 'prisma/migrations', migration),
        'utf8',
      );
      await pool.query(sql);
      console.log(`Verified migration: ${migration}`);
    }

    const constraints = await pool.query(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'public.roleplay_sessions'::regclass
        AND contype = 'c'
    `);
    const names = new Set(constraints.rows.map((row: { conname: string }) => row.conname));
    if (names.has('roleplay_session_xor_subject')) {
      throw new Error('Legacy XOR constraint remains after migration.');
    }
    if (!names.has('roleplay_session_at_most_one_subject')) {
      throw new Error('Replacement Roleplay ownership constraint is missing.');
    }

    const legalColumns = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'legal_agreement_versions'
        AND column_name IN ('legal_reviewed_by', 'legal_reviewed_at', 'legal_review_hash')
    `);
    if (legalColumns.rowCount !== 3) {
      throw new Error('Legal review metadata migration is incomplete.');
    }


    const legalRls = await pool.query(`
      SELECT relname
      FROM pg_class
      WHERE oid IN (
        'public.legal_agreement_versions'::regclass,
        'public.legal_agreement_acceptances'::regclass
      )
        AND relrowsecurity = true
    `);
    if (legalRls.rowCount !== 2) {
      throw new Error('Row-level security is not enabled on both legal agreement tables.');
    }

    // Operational tables must exist with their unique and foreign-key constraints.
    // This verifies the schema generated in CI, not the historical migration chain.
    const operationalTables = [
      'companies',
      'account_platforms',
      'company_production_reports',
      'company_report_reviews',
      'interpreter_account_assignments',
    ];
    for (const table of operationalTables) {
      const result = await pool.query(
        'SELECT to_regclass($1) AS relation',
        [`public.${table}`],
      );
      if (!result.rows[0]?.relation) {
        throw new Error(`Operational table is missing: ${table}`);
      }
    }

    // Prisma represents @@unique constraints as unique indexes in PostgreSQL.
    // They are not guaranteed to appear in pg_constraint, so inspect pg_index.
    const requiredUniqueIndexes = [
      ['account_platforms', 'account_platforms_account_id_name_key'],
      ['company_production_reports', 'company_production_reports_account_id_source_checksum_key'],
    ] as const;
    for (const [table, indexName] of requiredUniqueIndexes) {
      const result = await pool.query(
        `SELECT 1
         FROM pg_index AS index_meta
         JOIN pg_class AS index_class
           ON index_class.oid = index_meta.indexrelid
         JOIN pg_class AS table_class
           ON table_class.oid = index_meta.indrelid
         JOIN pg_namespace AS table_schema
           ON table_schema.oid = table_class.relnamespace
         WHERE table_schema.nspname = 'public'
           AND table_class.relname = $1
           AND index_class.relname = $2
           AND index_meta.indisunique = true
           AND index_meta.indisvalid = true
           AND index_meta.indisready = true`,
        [table, indexName],
      );
      if (!result.rowCount) {
        throw new Error(`Missing operational unique index: ${table}.${indexName}`);
      }
    }

    console.log('Critical legal and Roleplay migrations verified successfully.');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Critical migration verification failed:', error);
  process.exitCode = 1;
});
