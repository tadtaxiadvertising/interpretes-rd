import 'dotenv/config';

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { readCallKeyCatalog } from './call-idempotency-schema-catalog';
import { classifyCallKeySchema } from './call-idempotency-schema-state';

// Never run this integration verifier against real/shared PostgreSQL.
// Unlike production migrations, this script intentionally exercises rejected
// inserts and rolls back all fixtures and DDL in an isolated CI database.
function requireDisposableDatabase() {
  const raw = process.env.DATABASE_URL;
  if (!raw || process.env.CI !== 'true' || process.env.NODE_ENV === 'production') {
    throw new Error('Disposable CI database required.');
  }
  const url = new URL(raw);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.pathname !== '/interpreters_e2e' ||
      !['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Call idempotency verifier refuses non-isolated database.');
  }
  return raw;
}

async function expectSqlState(
  client: Client,
  sql: string,
  parameters: unknown[],
  expectedCode: string,
) {
  await client.query('SAVEPOINT rejected_write');
  let actualCode: string | undefined;
  try {
    await client.query(sql, parameters);
  } catch (error) {
    actualCode = (error as { code?: string } | null)?.code;
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT rejected_write');
    await client.query('RELEASE SAVEPOINT rejected_write');
  }
  if (actualCode !== expectedCode) {
    throw new Error('Unexpected PostgreSQL rejection behavior in isolated verifier.');
  }
}

async function main() {
  const client = new Client({ connectionString: requireDisposableDatabase() });
  await client.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;

    const before = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('public.call_submission_keys') IS NOT NULL AS exists",
    );
    if (before.rows[0]?.exists) {
      throw new Error('Isolated database already has call submission keys; refusing modification.');
    }

    // Staged SQL lives OUTSIDE prisma/migrations. Prisma migrate deploy
    // discovers every pending migration.sql under that directory, so even
    // a commented "staged only" file there is unsafe for later deployments.
    const sql = await readFile(resolve(
      process.cwd(),
      'docs/operations/staged-sql/call-submission-idempotency.sql',
    ), 'utf8');
    if (!sql.trim()) throw new Error('Staged idempotency SQL missing.');
    await client.query(sql);

    // A separate staged migration closes an ownership hole in the original
    // pair of independent foreign keys. Both files stay out of production.
    const ownershipSql = await readFile(resolve(
      process.cwd(),
      'docs/operations/staged-sql/call-submission-session-ownership.sql',
    ), 'utf8');
    if (!ownershipSql.trim()) throw new Error('Staged session ownership SQL missing.');
    await client.query(ownershipSql);

    // Verify that the *same SELECT-only catalog reader* used by operators
    // recognizes the exact DDL proposed for a later DBA-approved rollout.
    // Previous CI exercised only the absent (rolled-back) state.
    const stagedCatalog = await readCallKeyCatalog(client);
    // node-postgres does not parse pg_catalog name[] by default. Prevent
    // regression to textual "{column_name}" values disguised as string[].
    for (const constraint of stagedCatalog.constraints) {
      if (!Array.isArray(constraint.key_columns) ||
          !Array.isArray(constraint.references_columns) ||
          !constraint.key_columns.every(column => typeof column === 'string') ||
          !constraint.references_columns.every(column => typeof column === 'string')) {
        throw new Error('Catalog column metadata must be decoded JSON arrays.');
      }
    }
    const completeState = classifyCallKeySchema(stagedCatalog);
    if (completeState !== 'complete') {
      // These are metadata from disposable CI PostgreSQL ONLY. Print no
      // SQL, connection URLs, ids, key material or data records.
      const columnFlags = stagedCatalog.columns.map(column => ({
        name: column.column_name,
        type: column.data_type,
        required: column.is_nullable === 'NO',
        hasDefault: column.column_default != null,
      }));
      const constraintFlags = stagedCatalog.constraints.map(constraint => ({
        name: constraint.conname,
        type: constraint.contype,
        valid: constraint.convalidated,
        columns: constraint.key_columns,
        references: constraint.references_columns,
        onDelete: constraint.on_delete,
        onUpdate: constraint.on_update,
        checkContainsDigestPattern: constraint.definition.includes('[0-9a-f]{64}'),
      }));
      console.error('Disposable CI catalog shape:', JSON.stringify({
        state: completeState,
        rls: stagedCatalog.rlsEnabled,
        policyCount: stagedCatalog.policyCount,
        supportingIndex: stagedCatalog.supportingIndexValid,
        columns: columnFlags,
        constraints: constraintFlags,
      }));
      throw new Error('Staged DDL did not match the operational catalog contract.');
    }

    // Simulate an unexpected public RLS policy and a missing timestamp default:
    // both must reject readiness, without leaving a change in CI PostgreSQL.
    await client.query('SAVEPOINT check_unsafe_policy');
    try {
      await client.query(`CREATE POLICY ci_unapproved_policy
        ON public.call_submission_keys FOR ALL USING (true) WITH CHECK (true)`);
      if (classifyCallKeySchema(await readCallKeyCatalog(client)) !== 'partial') {
        throw new Error('Catalog reader failed to detect a permissive RLS policy.');
      }
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT check_unsafe_policy');
      await client.query('RELEASE SAVEPOINT check_unsafe_policy');
    }

    // A CHECK containing the right keywords may still be a tautology.
    // Exercise that failure mode against PostgreSQL's actual renderer,
    // never against application data or any production database.
    await client.query('SAVEPOINT check_weakened_source_check');
    try {
      await client.query('ALTER TABLE public.call_submission_keys DROP CONSTRAINT call_submission_keys_source_check');
      await client.query(`ALTER TABLE public.call_submission_keys
        ADD CONSTRAINT call_submission_keys_source_check
        CHECK (source IN ('quick_log_action', 'quick_log_api', 'admin_manual') OR TRUE)`);
      if (classifyCallKeySchema(await readCallKeyCatalog(client)) !== 'partial') {
        throw new Error('Catalog reader accepted a weakened source CHECK.');
      }
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT check_weakened_source_check');
      await client.query('RELEASE SAVEPOINT check_weakened_source_check');
    }

    await client.query('SAVEPOINT check_weakened_digest_check');
    try {
      await client.query('ALTER TABLE public.call_submission_keys DROP CONSTRAINT call_submission_keys_digest_check');
      await client.query(`ALTER TABLE public.call_submission_keys
        ADD CONSTRAINT call_submission_keys_digest_check
        CHECK (payload_sha256 ~ '^[0-9a-f]{64}' OR TRUE)`);
      if (classifyCallKeySchema(await readCallKeyCatalog(client)) !== 'partial') {
        throw new Error('Catalog reader accepted a weakened digest CHECK.');
      }
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT check_weakened_digest_check');
      await client.query('RELEASE SAVEPOINT check_weakened_digest_check');
    }

    await client.query('SAVEPOINT check_missing_default');
    try {
      await client.query('ALTER TABLE public.call_submission_keys ALTER COLUMN created_at DROP DEFAULT');
      if (classifyCallKeySchema(await readCallKeyCatalog(client)) !== 'partial') {
        throw new Error('Catalog reader failed to detect a missing timestamp default.');
      }
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT check_missing_default');
      await client.query('RELEASE SAVEPOINT check_missing_default');
    }

    const table = await client.query<{ rls_enabled: boolean }>(
      `SELECT c.relrowsecurity AS rls_enabled
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'call_submission_keys'`,
    );
    if (table.rowCount !== 1 || table.rows[0]?.rls_enabled !== true) {
      throw new Error('Staged idempotency mapping must have RLS enabled.');
    }

    const constraints = await client.query<{ conname: string; contype: string }>(
      `SELECT conname, contype
       FROM pg_constraint
       WHERE conrelid = 'public.call_submission_keys'::regclass`,
    );
    const types = new Map(constraints.rows.map(c => [c.conname, c.contype]));
    const expected = [
      ['call_submission_keys_pkey', 'p'],
      ['call_submission_keys_call_session_unique', 'u'],
      ['call_submission_keys_interpreter_fkey', 'f'],
      ['call_submission_keys_session_fkey', 'f'],
      ['call_submission_keys_session_ownership_fkey', 'f'],
      ['call_submission_keys_source_check', 'c'],
      ['call_submission_keys_digest_check', 'c'],
    ];
    for (const [name, expectedType] of expected) {
      if (types.get(name) !== expectedType) {
        throw new Error('Staged idempotency constraint missing or changed.');
      }
    }

    const indexes = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'call_sessions'`,
    );
    if (!indexes.rows.some(row =>
      row.indexname === 'ux_call_sessions_id_interpreter_for_idempotency')) {
      throw new Error('Staged ownership FK supporting index is missing.');
    }

    const count = await client.query<{ total: number }>(
      'SELECT COUNT(*)::int AS total FROM public.call_submission_keys',
    );
    if (count.rows[0]?.total !== 0) {
      throw new Error('Staged idempotency schema unexpectedly backfilled historical rows.');
    }

    // Only invented, synthetic rows in the open transaction. All fixture
    // writes are rolled back even when an assertion fails.
    const interpreter = await client.query<{ id: number }>(
      `INSERT INTO public.interpreters
         (external_id, name, tariff_per_minute)
       VALUES ('ci-idempotency-synthetic-interpreter', 'CI synthetic', 0.25)
       RETURNING id`,
    );
    const interpreterId = interpreter.rows[0]?.id;
    if (!interpreterId) throw new Error('Synthetic interpreter creation failed.');

    const sessionOne = await client.query<{ id: number }>(
      `INSERT INTO public.call_sessions
        (interpreter_id, started_at, ended_at, duration_seconds, tariff_snapshot)
       VALUES ($1, CURRENT_TIMESTAMP - INTERVAL '2 minutes', CURRENT_TIMESTAMP, 120, 0.25)
       RETURNING id`, [interpreterId],
    );
    const sessionTwo = await client.query<{ id: number }>(
      `INSERT INTO public.call_sessions
        (interpreter_id, started_at, ended_at, duration_seconds, tariff_snapshot)
       VALUES ($1, CURRENT_TIMESTAMP - INTERVAL '3 minutes', CURRENT_TIMESTAMP, 180, 0.25)
       RETURNING id`, [interpreterId],
    );
    const callOne = sessionOne.rows[0]?.id;
    const callTwo = sessionTwo.rows[0]?.id;
    if (!callOne || !callTwo) throw new Error('Synthetic call fixture creation failed.');

    const interpreterOther = await client.query<{ id: number }>(
      `INSERT INTO public.interpreters
         (external_id, name, tariff_per_minute)
       VALUES ('ci-idempotency-other-interpreter', 'Other CI synthetic', 0.25)
       RETURNING id`,
    );
    const otherId = interpreterOther.rows[0]?.id;
    if (!otherId || otherId === interpreterId) {
      throw new Error('Synthetic cross-interpreter fixture creation failed.');
    }

    const keyOne = '00000000-0000-4000-8000-000000000001';
    const keyTwo = '00000000-0000-4000-8000-000000000002';
    const digest = 'a'.repeat(64);
    const insert = `INSERT INTO public.call_submission_keys
      (interpreter_id, request_key, source, payload_sha256, call_session_id)
      VALUES ($1, $2, $3, $4, $5)`;
    await client.query(insert, [interpreterId, keyOne, 'quick_log_action', digest, callOne]);

    await expectSqlState(client, insert,
      [interpreterId, keyOne, 'quick_log_api', digest, callTwo], '23505');
    await expectSqlState(client, insert,
      [interpreterId, keyTwo, 'quick_log_action', digest, callOne], '23505');
    await expectSqlState(client, insert,
      [interpreterId, keyTwo, 'arbitrary_source', digest, callTwo], '23514');
    await expectSqlState(client, insert,
      [interpreterId, keyTwo, 'quick_log_action', 'not-a-digest', callTwo], '23514');
    await expectSqlState(client, insert,
      [-2147483647, keyTwo, 'quick_log_action', digest, callTwo], '23503');

    // Both referenced rows exist, yet pairing another interpreter with an
    // existing call is forbidden. Separate FKs alone would allow this.
    await expectSqlState(client, insert,
      [otherId, keyTwo, 'quick_log_action', digest, callTwo], '23503');
    // Even an existing mapping cannot be reassigned later to a different
    // interpreter by mutating call_sessions.
    await expectSqlState(client,
      'UPDATE public.call_sessions SET interpreter_id = $1 WHERE id = $2',
      [otherId, callOne], '23503');
    await expectSqlState(client,
      'DELETE FROM public.call_sessions WHERE id = $1', [callOne], '23503');

    // Missing backend-issued request key cannot be silently converted into an
    // empty value: DB rejects NULL (23502), while UUID rejects invalid syntax.
    await expectSqlState(client, insert,
      [interpreterId, null, 'quick_log_action', digest, callTwo], '23502');

    await client.query('ROLLBACK');
    inTransaction = false;

    const after = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('public.call_submission_keys') IS NOT NULL AS exists",
    );
    if (after.rows[0]?.exists) throw new Error('Isolated verifier left schema changes behind.');
    const indexAfter = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('public.ux_call_sessions_id_interpreter_for_idempotency') IS NOT NULL AS exists",
    );
    if (indexAfter.rows[0]?.exists) {
      throw new Error('Isolated verifier left the staged ownership index behind.');
    }
    if (classifyCallKeySchema(await readCallKeyCatalog(client)) !== 'absent') {
      throw new Error('Catalog reader failed to recognize pristine PostgreSQL after rollback.');
    }

    console.log('Staged call idempotency SQL verified on isolated PostgreSQL: complete/partial/absent catalog roundtrip, uniqueness, ownership, RLS, foreign keys, checks and rollback.');
  } finally {
    if (inTransaction) await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

void main().catch(() => {
  // Do not dump PostgreSQL errors: even schema/fixture errors can contain PII
  // or connection information from a misconfigured CI environment.
  console.error('Isolated call idempotency schema verification failed.');
  process.exitCode = 1;
});
