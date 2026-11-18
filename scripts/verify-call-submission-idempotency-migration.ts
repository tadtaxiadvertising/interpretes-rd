import 'dotenv/config';

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';

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

    const sql = await readFile(resolve(
      process.cwd(),
      'prisma/migrations/20261118200000_call_submission_idempotency/migration.sql',
    ), 'utf8');
    if (!sql.trim()) throw new Error('Staged idempotency SQL missing.');
    await client.query(sql);

    // A separate staged migration closes an ownership hole in the original
    // pair of independent foreign keys. Both files stay out of production.
    const ownershipSql = await readFile(resolve(
      process.cwd(),
      'prisma/migrations/20261118213000_call_submission_session_ownership/migration.sql',
    ), 'utf8');
    if (!ownershipSql.trim()) throw new Error('Staged session ownership SQL missing.');
    await client.query(ownershipSql);

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

    console.log('Staged call idempotency SQL verified on isolated PostgreSQL: uniqueness, ownership, RLS, foreign keys, checks and rollback.');
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
