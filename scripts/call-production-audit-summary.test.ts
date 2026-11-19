// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { callProductionAuditSummary } from './call-production-audit-summary';

const synthetic = {
  interpreter_day_groups: '4',
  total_sessions: '6',
  ended_sessions: '5',
  ended_without_ledger_sessions: '2',
  known_quicklog_without_ledger_sessions: '1',
  known_admin_manual_without_ledger_sessions: '1',
  ended_missing_duration_sessions: '2',
  ended_zero_duration_with_elapsed_sessions: '1',
  ended_missing_cost_sessions: '3',
  possible_duplicate_quicklog_sessions: '2',
  ended_session_minutes: '110',
  ledger_entries: '3',
  ledger_orphan_entries: '1',
  ledger_owner_mismatch_entries: '0',
  ledger_day_mismatch_entries: '1',
  ledger_minutes: '70',
  production_logs: '3',
  production_effective_minutes: '105',
  session_minus_ledger_minutes: '40',
  production_minus_ledger_minutes: '35',
  groups_with_session_ledger_difference: '2',
  groups_with_production_ledger_difference: '1',
  groups_with_ended_calls_without_ledger: '1',
};

describe('read-only reconciliation report privacy', () => {
  it('passes only an allow-list of aggregate counts and hides unknown sensitive keys', () => {
    const summary = callProductionAuditSummary({
      ...synthetic,
      interpreter_id: 123,
      production_date: '2026-11-18',
      email: 'synthetic@example.invalid',
      secret: 'DO_NOT_LOG',
    });
    expect(summary).toEqual(Object.fromEntries(
      Object.entries(synthetic).map(([name, value]) => [name, Number(value)]),
    ));
    expect(JSON.stringify(summary)).not.toContain('DO_NOT_LOG');
    expect(JSON.stringify(summary)).not.toContain('interpreter_id');
    expect(JSON.stringify(summary)).not.toContain('production_date');
  });

  it('permits negative reconciliation differences but rejects negative counts', () => {
    const summary = callProductionAuditSummary({
      ...synthetic,
      ended_session_minutes: '60',
      production_effective_minutes: '67',
      session_minus_ledger_minutes: '-10',
      production_minus_ledger_minutes: -3,
    });
    expect(summary.session_minus_ledger_minutes).toBe(-10);
    expect(summary.production_minus_ledger_minutes).toBe(-3);
    expect(() => callProductionAuditSummary({ ...synthetic, ledger_entries: '-1' })).toThrow();
  });

  it('refuses incomplete, fractional and unsafe integers instead of falsifying accounting totals', () => {
    expect(() => callProductionAuditSummary({ ...synthetic, ledger_minutes: undefined })).toThrow();
    expect(() => callProductionAuditSummary({ ...synthetic, ledger_orphan_entries: undefined })).toThrow();
    expect(() => callProductionAuditSummary({ ...synthetic, ledger_owner_mismatch_entries: '-1' })).toThrow();
    expect(() => callProductionAuditSummary({ ...synthetic, ledger_day_mismatch_entries: '1.5' })).toThrow();
    expect(() => callProductionAuditSummary({ ...synthetic, known_quicklog_without_ledger_sessions: undefined })).toThrow();
    expect(() => callProductionAuditSummary({ ...synthetic, known_admin_manual_without_ledger_sessions: '-1' })).toThrow();
    expect(() => callProductionAuditSummary({ ...synthetic, ended_missing_duration_sessions: undefined })).toThrow();
    expect(() => callProductionAuditSummary({ ...synthetic, ended_zero_duration_with_elapsed_sessions: '-1' })).toThrow();
    expect(() => callProductionAuditSummary({ ...synthetic, ended_missing_cost_sessions: '1.5' })).toThrow();
    expect(() => callProductionAuditSummary({ ...synthetic, possible_duplicate_quicklog_sessions: '-1' })).toThrow();
    expect(() => callProductionAuditSummary({ ...synthetic, possible_duplicate_quicklog_sessions: undefined })).toThrow();
    expect(() => callProductionAuditSummary({ ...synthetic, total_sessions: 'NaN' })).toThrow();
    expect(() => callProductionAuditSummary({ ...synthetic, total_sessions: '1.5' })).toThrow();
    expect(() => callProductionAuditSummary({ ...synthetic, total_sessions: '9007199254740993' })).toThrow();
    expect(() => callProductionAuditSummary(null)).toThrow();
  });

  it('rejects accounting subsets larger than their parent totals', () => {
    for (const overrides of [
      { ended_sessions: '7' },
      { ended_without_ledger_sessions: '6' },
      { known_quicklog_without_ledger_sessions: '2' },
      { known_admin_manual_without_ledger_sessions: '2' },
      { ended_missing_duration_sessions: '6' },
      { ended_zero_duration_with_elapsed_sessions: '6' },
      { ended_missing_cost_sessions: '6' },
      { possible_duplicate_quicklog_sessions: '6' },
      { ledger_orphan_entries: '4' },
      { ledger_owner_mismatch_entries: '4' },
      { ledger_day_mismatch_entries: '4' },
      { groups_with_session_ledger_difference: '5' },
      { groups_with_production_ledger_difference: '5' },
      { groups_with_ended_calls_without_ledger: '5' },
    ]) {
      expect(() => callProductionAuditSummary({ ...synthetic, ...overrides }))
        .toThrow('Invalid aggregate reconciliation result');
    }
  });

  it('rejects inconsistencies between aggregate minute totals and reported differences', () => {
    expect(() => callProductionAuditSummary({
      ...synthetic,
      session_minus_ledger_minutes: '41',
    })).toThrow('Invalid aggregate reconciliation result');
    expect(() => callProductionAuditSummary({
      ...synthetic,
      production_minus_ledger_minutes: '34',
    })).toThrow('Invalid aggregate reconciliation result');
    // Very large-but-safe totals must not silently round differences.
    expect(() => callProductionAuditSummary({
      ...synthetic,
      ended_session_minutes: Number.MAX_SAFE_INTEGER,
      ledger_minutes: '1',
      session_minus_ledger_minutes: Number.MAX_SAFE_INTEGER,
    })).toThrow('Invalid aggregate reconciliation result');
  });

  it('accepts an empty audit and fully accounted sessions', () => {
    const empty = Object.fromEntries(
      Object.keys(synthetic).map(key => [key, '0']),
    );
    expect(callProductionAuditSummary(empty))
      .toEqual(Object.fromEntries(Object.keys(synthetic).map(key => [key, 0])));

    const complete = {
      ...synthetic,
      ended_without_ledger_sessions: '0',
      known_quicklog_without_ledger_sessions: '0',
      known_admin_manual_without_ledger_sessions: '0',
      groups_with_ended_calls_without_ledger: '0',
    };
    expect(callProductionAuditSummary(complete).ended_without_ledger_sessions).toBe(0);
  });

  it('maintains the privacy boundary in the SQL-driven CLI', () => {
    const script = readFileSync(new URL('./reconcile-call-production-readonly.ts', import.meta.url), 'utf8');
    expect(script).toContain('output: \'AGGREGATE_ONLY\'');
    expect(script).toContain('FROM interpreter_day');
    expect(script).toContain('ended_missing_duration_count');
    expect(script).toContain('known_quicklog_missing_ledger_count');
    expect(script).toContain('LEFT JOIN public.call_sessions cs ON cs.id = cpe.call_session_id');
    expect(script).toContain('ledger_orphan_count');
    expect(script).toContain('ledger_owner_mismatch_count');
    expect(script).toContain('ledger_day_mismatch_count');
    expect(script).toContain('ledger_orphan_entries');
    expect(script).toContain('ledger_owner_mismatch_entries');
    expect(script).toContain('ledger_day_mismatch_entries');
    expect(script).toContain('cs.interpreter_id IS DISTINCT FROM cpe.interpreter_id');
    expect(script).toContain('IS DISTINCT FROM cpe.production_date');
    expect(script).toContain('known_admin_manual_missing_ledger_count');
    expect(script).toContain('known_quicklog_without_ledger_sessions');
    expect(script).toContain('known_admin_manual_without_ledger_sessions');
    expect(script).toContain("cs.notes = 'Manual entry by Administrator'");
    expect(script).toContain('ended_zero_duration_with_elapsed_count');
    expect(script).toContain('ended_missing_cost_count');
    expect(script).toContain('quick_log_candidate_duplicates');
    expect(script).toContain('possible_duplicate_quicklog_sessions');
    expect(script).toContain("cs.notes IN ('Quick log by interpreter', 'Manual entry via Quick Log')");
    expect(script).toContain("created_at <= previous_created_at + INTERVAL '30 seconds'");
    expect(script).toContain('cs.ended_at >= cs.started_at + INTERVAL \'60 seconds\'');
    expect(script).toContain('BEGIN READ ONLY');
    expect(script).toContain('callProductionAuditSummary(result.rows[0])');
    expect(script).not.toContain('rowCount: rows.length');
    expect(script).not.toContain('      rows,');
    expect(script).not.toMatch(/console\.error\('Read-only call reconciliation failed:', error\)/);
  });
});
