import { Client } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required for read-only call reconciliation.');
}

const [fromDate, toDate] = process.argv.slice(2);

function isValidDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

if (!isValidDate(fromDate) || !isValidDate(toDate) || fromDate > toDate) {
  throw new Error(
    'Usage: npx tsx scripts/reconcile-call-production-readonly.ts YYYY-MM-DD YYYY-MM-DD (inclusive, Santo Domingo dates).',
  );
}

const reconciliationQuery = `
  WITH session_daily AS (
    SELECT
      cs.interpreter_id,
      (cs.started_at AT TIME ZONE 'America/Santo_Domingo')::date AS production_date,
      COUNT(*)::int AS session_count,
      COUNT(*) FILTER (WHERE cs.ended_at IS NOT NULL)::int AS ended_session_count,
      COUNT(*) FILTER (
        WHERE cs.ended_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM public.call_production_entries cpe
            WHERE cpe.call_session_id = cs.id
          )
      )::int AS ended_without_ledger_count,
      COALESCE(SUM(
        CASE
          WHEN cs.ended_at IS NOT NULL
          THEN FLOOR(GREATEST(COALESCE(cs.duration_seconds, 0), 0)::numeric / 60)
          ELSE 0
        END
      ), 0)::int AS ended_session_minutes
    FROM public.call_sessions cs
    WHERE cs.interpreter_id IS NOT NULL
      AND cs.started_at IS NOT NULL
      AND (cs.started_at AT TIME ZONE 'America/Santo_Domingo')::date
          BETWEEN $1::date AND $2::date
    GROUP BY cs.interpreter_id, (cs.started_at AT TIME ZONE 'America/Santo_Domingo')::date
  ),
  ledger_daily AS (
    SELECT
      cpe.interpreter_id,
      cpe.production_date,
      COUNT(*)::int AS ledger_entry_count,
      COALESCE(SUM(cpe.interpreted_minutes), 0)::int AS ledger_minutes,
      COALESCE(SUM(cpe.calls_attended), 0)::int AS ledger_calls
    FROM public.call_production_entries cpe
    WHERE cpe.production_date BETWEEN $1::date AND $2::date
    GROUP BY cpe.interpreter_id, cpe.production_date
  ),
  production_daily AS (
    SELECT
      pl.interpreter_id,
      pl.date AS production_date,
      COUNT(*)::int AS production_log_count,
      COALESCE(SUM(COALESCE(pl.verified_minutes, pl.interpreted_minutes, 0)), 0)::int
        AS production_log_effective_minutes,
      COALESCE(SUM(COALESCE(pl.calls_attended, 0)), 0)::int AS production_log_calls
    FROM public.production_logs pl
    WHERE pl.interpreter_id IS NOT NULL
      AND pl.date BETWEEN $1::date AND $2::date
    GROUP BY pl.interpreter_id, pl.date
  ),
  keys AS (
    SELECT interpreter_id, production_date FROM session_daily
    UNION
    SELECT interpreter_id, production_date FROM ledger_daily
    UNION
    SELECT interpreter_id, production_date FROM production_daily
  )
  SELECT
    keys.interpreter_id,
    keys.production_date,
    COALESCE(s.session_count, 0)::int AS session_count,
    COALESCE(s.ended_session_count, 0)::int AS ended_session_count,
    COALESCE(s.ended_without_ledger_count, 0)::int AS ended_without_ledger_count,
    COALESCE(s.ended_session_minutes, 0)::int AS ended_session_minutes,
    COALESCE(l.ledger_entry_count, 0)::int AS ledger_entry_count,
    COALESCE(l.ledger_minutes, 0)::int AS ledger_minutes,
    COALESCE(l.ledger_calls, 0)::int AS ledger_calls,
    COALESCE(p.production_log_count, 0)::int AS production_log_count,
    COALESCE(p.production_log_effective_minutes, 0)::int AS production_log_effective_minutes,
    COALESCE(p.production_log_calls, 0)::int AS production_log_calls,
    (COALESCE(s.ended_session_minutes, 0) - COALESCE(l.ledger_minutes, 0))::int
      AS session_minus_ledger_minutes,
    (COALESCE(p.production_log_effective_minutes, 0) - COALESCE(l.ledger_minutes, 0))::int
      AS production_log_minus_ledger_minutes
  FROM keys
  LEFT JOIN session_daily s
    ON s.interpreter_id = keys.interpreter_id
   AND s.production_date = keys.production_date
  LEFT JOIN ledger_daily l
    ON l.interpreter_id = keys.interpreter_id
   AND l.production_date = keys.production_date
  LEFT JOIN production_daily p
    ON p.interpreter_id = keys.interpreter_id
   AND p.production_date = keys.production_date
  ORDER BY keys.production_date, keys.interpreter_id
`;

async function main() {
  const client = new Client({ connectionString });
  await client.connect();
  let transactionStarted = false;

  try {
    // Enforce read-only behavior at the PostgreSQL transaction level. The
    // script contains SELECT statements only and always rolls back on exit.
    await client.query('BEGIN READ ONLY');
    transactionStarted = true;
    await client.query("SET LOCAL statement_timeout = '60s'");

    const result = await client.query(reconciliationQuery, [fromDate, toDate]);
    const rows = result.rows.map((row) => ({
      ...row,
      production_date: row.production_date instanceof Date
        ? row.production_date.toISOString().slice(0, 10)
        : row.production_date,
    }));

    console.log(JSON.stringify({
      mode: 'READ_ONLY',
      timezone: 'America/Santo_Domingo',
      fromDate,
      toDate,
      rowCount: rows.length,
      interpretation: [
        'ended_without_ledger_count identifies sessions without a per-session ledger entry; it does not prove they are absent from ProductionLog.',
        'production_log_minus_ledger_minutes is diagnostic only: ProductionLog can also contain manual/imported minutes and verified adjustments.',
        'No row is classified as safe to import, and this report never repairs, inserts, updates, or deletes data.',
      ],
      rows,
    }, null, 2));
  } finally {
    if (transactionStarted) await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('Read-only call reconciliation failed:', error);
  process.exitCode = 1;
});
