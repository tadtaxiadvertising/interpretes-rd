import type { Client } from 'pg';
import type { CallKeyCatalog, CatalogColumn, CatalogConstraint } from './call-idempotency-schema-state';

/**
 * Shared catalog-only SELECTs. No writes or migrations. Separating these
 * reads from the CLI permits exercising the REAL catalog classifier against
 * both a fully staged schema and a pristine DB in the same disposable CI run.
 */
export async function readCallKeyCatalog(client: Client): Promise<CallKeyCatalog> {
  const table = await client.query<{ rls_enabled: boolean }>(
    `SELECT relrowsecurity AS rls_enabled
     FROM pg_class WHERE oid = to_regclass('public.call_submission_keys')`,
  );
  const tableExists = table.rowCount === 1;
  const columns = tableExists ? await client.query<CatalogColumn>(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'call_submission_keys'`,
  ) : { rows: [] as CatalogColumn[] };
  // PostgreSQL name[] has no default array parser in node-postgres. Emit
  // JSON arrays instead so CatalogConstraint columns are real string[]
  // (not textual "{id,interpreter_id}" values that silently fail checks).
  const constraints = tableExists ? await client.query<CatalogConstraint>(
    `SELECT c.conname, c.contype, c.convalidated,
       to_json(ARRAY(
         SELECT a.attname
         FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
         JOIN pg_attribute AS a
           ON a.attrelid = c.conrelid AND a.attnum = k.attnum
         ORDER BY k.ord
       )) AS key_columns,
       rns.nspname AS references_schema,
       referenced.relname AS references_table,
       to_json(ARRAY(
         SELECT a.attname
         FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
         JOIN pg_attribute AS a
           ON a.attrelid = c.confrelid AND a.attnum = k.attnum
         ORDER BY k.ord
       )) AS references_columns,
       c.confdeltype AS on_delete,
       c.confupdtype AS on_update,
       pg_get_constraintdef(c.oid) AS definition
     FROM pg_constraint AS c
     LEFT JOIN pg_class AS referenced ON referenced.oid = c.confrelid
     LEFT JOIN pg_namespace AS rns ON rns.oid = referenced.relnamespace
     WHERE c.conrelid = to_regclass('public.call_submission_keys')`,
  ) : { rows: [] as CatalogConstraint[] };

  // The staged design has no direct-client RLS policies. A permissive
  // policy added later requires renewed security review, even with RLS on.
  const policies = await client.query<{ policy_count: number }>(
    `SELECT COUNT(*)::int AS policy_count
     FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'call_submission_keys'`,
  );

  const index = await client.query<{ valid: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM pg_index AS i
       WHERE i.indexrelid = to_regclass('public.ux_call_sessions_id_interpreter_for_idempotency')
         AND i.indrelid = to_regclass('public.call_sessions')
         AND i.indisunique AND i.indisvalid AND i.indisready
         AND i.indnkeyatts = 2
         AND i.indkey[0] = (
           SELECT attnum FROM pg_attribute
           WHERE attrelid = to_regclass('public.call_sessions') AND attname = 'id'
         )
         AND i.indkey[1] = (
           SELECT attnum FROM pg_attribute
           WHERE attrelid = to_regclass('public.call_sessions') AND attname = 'interpreter_id'
         )
     ) AS valid`,
  );

  // A past Prisma migrate deploy may have run the old staged filenames.
  // This is not a claim about their presence or absence on any live server.
  const historyTable = await client.query<{ exists: boolean }>(
    "SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS exists",
  );
  const migrationRecords = historyTable.rows[0]?.exists ?
    await client.query<{
      migration_name: string; succeeded: boolean; rolled_back: boolean;
    }>(
      `SELECT migration_name,
         finished_at IS NOT NULL AS succeeded,
         rolled_back_at IS NOT NULL AS rolled_back
       FROM public._prisma_migrations
       WHERE migration_name = ANY($1::text[])`,
      [[
        '20261118200000_call_submission_idempotency',
        '20261118213000_call_submission_session_ownership',
      ]],
    ) : { rows: [] as CallKeyCatalog['migrationRecords'] };

  return {
    tableExists,
    rlsEnabled: table.rows[0]?.rls_enabled === true,
    policyCount: policies.rows[0]?.policy_count ?? -1,
    columns: columns.rows,
    constraints: constraints.rows,
    supportingIndexValid: index.rows[0]?.valid === true,
    migrationRecords: migrationRecords.rows,
  };
}

