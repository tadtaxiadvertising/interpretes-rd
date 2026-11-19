import 'dotenv/config';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { createDatabasePoolConfig } from '../src/lib/database-pool-config';
import { callProductionAuditSummary } from './call-production-audit-summary';
import { callProductionReconciliationQuery } from './call-production-audit-query';

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

const rangeDays = (Date.parse(`${toDate}T00:00:00.000Z`) - Date.parse(`${fromDate}T00:00:00.000Z`)) / 86_400_000;
if (rangeDays > 366) {
  throw new Error('Limit each reconciliation run to 367 calendar dates or fewer; split longer histories into smaller windows.');
}


async function main() {
  const caPem = readFileSync(join(process.cwd(), 'certs', 'prod-ca-2021.crt'), 'utf8');
  const client = new Client(createDatabasePoolConfig(connectionString, caPem));
  await client.connect();
  let transactionStarted = false;

  try {
    // Enforce read-only behavior at the PostgreSQL transaction level. The
    // script contains SELECT statements only and always rolls back on exit.
    await client.query('BEGIN READ ONLY');
    transactionStarted = true;
    await client.query("SET LOCAL statement_timeout = '60s'");

    const result = await client.query(callProductionReconciliationQuery, [fromDate, toDate]);
    if (result.rows.length !== 1) throw new Error('Invalid aggregate reconciliation result');
    const summary = callProductionAuditSummary(result.rows[0]);

    console.log(JSON.stringify({
      mode: 'READ_ONLY',
      output: 'AGGREGATE_ONLY',
      timezone: 'America/Santo_Domingo',
      fromDate,
      toDate,
      summary,
      interpretation: [
        'ended_without_ledger_sessions counts ended sessions lacking per-session ledger entries; it does not prove they are missing from ProductionLog.',
        'ledger_orphan_entries counts ledger rows whose call_session_id does not resolve to a call; it does not authorize deletion or payment changes.',
        'ledger_owner_mismatch_entries counts ledger rows whose interpreter differs from their source call; missing source calls are counted separately.',
        'ledger_day_mismatch_entries counts ledger rows with a different Santo Domingo date than their source call, including missing start timestamps; review historical conventions before corrections.',
        'known_quicklog_without_ledger_sessions is a subset identified by the two exact Quick Log note markers, not evidence that payable minutes are missing.',
        'known_admin_manual_without_ledger_sessions counts only default-tagged administrator manual calls; manually edited notes are not classified, and admin calls are not assumed payable.',
        'ended_missing_duration_sessions counts ended sessions with durationSeconds NULL; ended_zero_duration_with_elapsed_sessions counts zero-duration sessions with at least 60 seconds elapsed between stored timestamps.',
        'ended_missing_cost_sessions counts ended sessions with callCost NULL. These flags do not independently establish payable minutes or entitlement; investigate sources before correction.',
        'possible_duplicate_quicklog_sessions counts extra app-marked Quick Log sessions with equal duration created within 30 seconds of the preceding matching session, not proven duplicates; verify before any correction.',
        'Historical counts include only sessions with an interpreterId and startedAt in the selected Santo Domingo date range; sessions missing startedAt are excluded.',
        'production_minus_ledger_minutes is diagnostic only: ProductionLog can also contain manual/imported minutes and verified adjustments.',
        'No row is classified as safe to import, and this report never repairs, inserts, updates, or deletes data.',
      ],
    }, null, 2));
  } finally {
    if (transactionStarted) await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch(() => {
  // Driver failures can contain secret URLs, account values, or row data.
  console.error('Read-only call reconciliation failed. Check secure operator diagnostics.');
  process.exitCode = 1;
});
