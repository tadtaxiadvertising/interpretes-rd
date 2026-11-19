/**
 * Privacy boundary for the read-only call-production reconciliation report.
 * The SQL aggregates on the database; never forward unexpected row fields
 * (interpreter IDs, dates, account values, exception messages) to logs.
 */
const METRIC_FIELDS = [
  'interpreter_day_groups',
  'total_sessions',
  'ended_sessions',
  'ended_without_ledger_sessions',
  'known_quicklog_without_ledger_sessions',
  'known_admin_manual_without_ledger_sessions',
  'ended_missing_duration_sessions',
  'ended_zero_duration_with_elapsed_sessions',
  'ended_missing_cost_sessions',
  'possible_duplicate_quicklog_sessions',
  'ended_session_minutes',
  'ledger_entries',
  'ledger_orphan_entries',
  'ledger_owner_mismatch_entries',
  'ledger_day_mismatch_entries',
  'ledger_minutes',
  'production_logs',
  'production_effective_minutes',
  'session_minus_ledger_minutes',
  'production_minus_ledger_minutes',
  'groups_with_session_ledger_difference',
  'groups_with_production_ledger_difference',
  'groups_with_ended_calls_without_ledger',
] as const;

type MetricName = (typeof METRIC_FIELDS)[number];

function validatedInteger(value: unknown, name: MetricName): number {
  // pg returns COUNT and SUM(bigint) as decimal strings. Avoid precision loss
  // rather than reporting fictitious financial differences.
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error('Invalid aggregate reconciliation result');
  }
  if (typeof value === 'string' && !/^-?[0-9]+$/.test(value)) {
    throw new Error('Invalid aggregate reconciliation result');
  }
  const num = Number(value);
  if (!Number.isSafeInteger(num) ||
      (name !== 'session_minus_ledger_minutes' &&
       name !== 'production_minus_ledger_minutes' && num < 0)) {
    throw new Error('Invalid aggregate reconciliation result');
  }
  return num;
}

export function callProductionAuditSummary(result: unknown): Record<MetricName, number> {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw new Error('Invalid aggregate reconciliation result');
  }
  const record = result as Record<string, unknown>;
  const summary = Object.fromEntries(
    METRIC_FIELDS.map(name => [name, validatedInteger(record[name], name)]),
  ) as Record<MetricName, number>;

  // The SQL reports subsets and exact differences of the same grouped rows.
  // Individual safe integers are not enough: a drifted or partially changed
  // query can silently generate impossible accounting diagnostics.
  const {
    interpreter_day_groups: groups,
    total_sessions: sessions,
    ended_sessions: ended,
    ended_without_ledger_sessions: missingLedger,
    known_quicklog_without_ledger_sessions: quickLogMissing,
    known_admin_manual_without_ledger_sessions: adminManualMissing,
  } = summary;
  if (
    ended > sessions ||
    missingLedger > ended ||
    quickLogMissing + adminManualMissing > missingLedger ||
    summary.ended_missing_duration_sessions > ended ||
    summary.ended_zero_duration_with_elapsed_sessions > ended ||
    summary.ended_missing_cost_sessions > ended ||
    summary.possible_duplicate_quicklog_sessions > ended ||
    summary.ledger_orphan_entries > summary.ledger_entries ||
    summary.ledger_owner_mismatch_entries > summary.ledger_entries ||
    summary.ledger_day_mismatch_entries > summary.ledger_entries ||
    summary.groups_with_session_ledger_difference > groups ||
    summary.groups_with_production_ledger_difference > groups ||
    summary.groups_with_ended_calls_without_ledger > groups ||
    // Use BigInt to avoid rounding a difference near MAX_SAFE_INTEGER.
    BigInt(summary.ended_session_minutes) - BigInt(summary.ledger_minutes) !==
      BigInt(summary.session_minus_ledger_minutes) ||
    BigInt(summary.production_effective_minutes) - BigInt(summary.ledger_minutes) !==
      BigInt(summary.production_minus_ledger_minutes)
  ) {
    // Never expose raw rows, interpreter IDs or untrusted provider values.
    throw new Error('Invalid aggregate reconciliation result');
  }

  return summary;
}
