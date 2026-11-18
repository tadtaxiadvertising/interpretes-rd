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
  'ended_session_minutes',
  'ledger_entries',
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
  return Object.fromEntries(
    METRIC_FIELDS.map(name => [name, validatedInteger(record[name], name)]),
  ) as Record<MetricName, number>;
}
