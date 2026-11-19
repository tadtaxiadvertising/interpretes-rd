/**
 * CI-only PostgreSQL integration check for the exact operator audit SQL.
 * This file cannot read DATABASE_URL, DIRECT_URL or any production secrets.
 * It connects exclusively to the disposable PostgreSQL service on loopback.
 * Synthetic fixtures live in a transaction that is ALWAYS rolled back.
 */
import { Client } from 'pg';
import { callProductionReconciliationQuery } from '../call-production-audit-query';
import { callProductionAuditSummary } from '../call-production-audit-summary';

if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true') {
  throw new Error('Isolated call audit verifier is CI-only');
}

const client = new Client({
  host: '127.0.0.1',
  port: 5432,
  database: 'interpreters_e2e',
  user: 'postgres',
  password: 'postgres',
  ssl: false,
  connectionTimeoutMillis: 5_000,
  query_timeout: 15_000,
  application_name: 'interpretes-audit-synthetic-ci',
});

const DATES = ['2026-11-18', '2026-11-19'];
let inTransaction = false;

function requireCount(
  summary: ReturnType<typeof callProductionAuditSummary>,
  field: keyof ReturnType<typeof callProductionAuditSummary>,
  expected: number,
) {
  if (summary[field] !== expected) {
    // Never serialize query rows, identities or database error details.
    throw new Error('Synthetic call audit aggregate mismatch');
  }
}

async function runAudit() {
  const result = await client.query(callProductionReconciliationQuery, DATES);
  if (result.rows.length !== 1) throw new Error('Unexpected audit result shape');
  return callProductionAuditSummary(result.rows[0]);
}

async function createInterpreter(suffix: string): Promise<number> {
  const result = await client.query<{ id: number }>(
    `INSERT INTO public.interpreters (external_id, name, tariff_per_minute)
     VALUES ($1, 'Synthetic CI Audit', 1.00) RETURNING id`,
    [`ci-reconcile-${suffix}`],
  );
  return result.rows[0].id;
}

async function createSession(interpreterId: number, seconds: number, notes: string): Promise<number> {
  const result = await client.query<{ id: number }>(
    `INSERT INTO public.call_sessions (
       interpreter_id, started_at, ended_at, duration_seconds,
       tariff_snapshot, call_cost, notes
     ) VALUES ($1, '2026-11-18T15:00:00Z', '2026-11-18T15:05:00Z',
               $2, 1.00, 1.00, $3) RETURNING id`,
    [interpreterId, seconds, notes],
  );
  return result.rows[0].id;
}

async function createLedger(
  sessionId: number, interpreterId: number, date: string, minutes: number,
) {
  await client.query(
    `INSERT INTO public.call_production_entries (
       call_session_id, interpreter_id, production_date, interpreted_minutes, calls_attended
     ) VALUES ($1, $2, $3::date, $4, 1)`,
    [sessionId, interpreterId, date, minutes],
  );
}

async function main() {
  await client.connect();
  try {
    // Prove the real query parses and validates even on an empty schema.
    await client.query('BEGIN READ ONLY');
    inTransaction = true;
    await client.query("SET LOCAL statement_timeout = '15s'");
    const empty = await runAudit();
    if (Object.values(empty).some(value => value !== 0)) {
      throw new Error('CI audit database is not empty');
    }
    await client.query('ROLLBACK');
    inTransaction = false;

    // Insert only synthetic records into the local disposable database.
    // This transaction is rolled back even if the assertions fail.
    await client.query('BEGIN');
    inTransaction = true;
    await client.query("SET LOCAL statement_timeout = '15s'");
    const owner = await createInterpreter('owner');
    const other = await createInterpreter('other');
    const correct = await createSession(owner, 120, 'Synthetic CI');
    const wrongOwner = await createSession(owner, 60, 'Synthetic CI');
    const wrongDay = await createSession(owner, 60, 'Synthetic CI');
    await createSession(owner, 60, 'Manual entry via Quick Log');
    await createSession(owner, 60, 'Manual entry by Administrator');

    await createLedger(correct, owner, '2026-11-18', 2);
    await createLedger(wrongOwner, other, '2026-11-18', 1);
    await createLedger(wrongDay, owner, '2026-11-19', 1);
    // The staged ledger has no FK to CallSession. Test the orphan signal.
    await createLedger(-184512, owner, '2026-11-18', 0);
    await client.query(
      `INSERT INTO public.production_logs (
         interpreter_id, date, status, interpreted_minutes, calls_attended
       ) VALUES ($1, '2026-11-18', 'Completed', 6, 5)`,
      [owner],
    );

    const actual = await runAudit();
    const expected = {
      total_sessions: 5,
      ended_sessions: 5,
      ended_without_ledger_sessions: 2,
      known_quicklog_without_ledger_sessions: 1,
      known_admin_manual_without_ledger_sessions: 1,
      ledger_entries: 4,
      ledger_orphan_entries: 1,
      ledger_owner_mismatch_entries: 1,
      ledger_day_mismatch_entries: 1,
      ended_session_minutes: 6,
      ledger_minutes: 4,
      production_effective_minutes: 6,
      session_minus_ledger_minutes: 2,
      production_minus_ledger_minutes: 2,
    } as const;
    for (const [key, value] of Object.entries(expected)) {
      requireCount(actual, key as keyof typeof actual, value);
    }
    await client.query('ROLLBACK');
    inTransaction = false;
    console.log('Isolated call reconciliation SQL verified (empty and synthetic cases; rollback).');
  } finally {
    if (inTransaction) await client.query('ROLLBACK').catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

void main().catch(() => {
  // pg errors may contain SQL, credentials or identifiers. Never print them.
  console.error('Isolated call reconciliation SQL verification failed');
  process.exitCode = 1;
});
