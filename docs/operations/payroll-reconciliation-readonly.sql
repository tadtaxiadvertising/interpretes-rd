-- Intérpretes RD: historical payroll reconciliation preflight.
-- READ ONLY. Do not alter production data based only on these counts.
-- Requires authorized read-only PostgreSQL access. Never run a
-- write-capable reconciliation without backup, accounting sign-off,
-- individual case review and validated idempotency.
--
-- 1) Two pending, unpaid payroll periods for the same interpreter
-- cover at least one common calendar date. Each pair counted once.
SELECT COUNT(*)::bigint AS overlapping_pending_payroll_pairs
FROM public.payroll_records AS first_period
JOIN public.payroll_records AS second_period
  ON first_period.interpreter_id = second_period.interpreter_id
 AND first_period.id < second_period.id
 AND first_period.period_start <= second_period.period_end
 AND second_period.period_start <= first_period.period_end
WHERE first_period.interpreter_id IS NOT NULL
  AND first_period.status IN ('PENDING', 'Pendiente')
  AND second_period.status IN ('PENDING', 'Pendiente')
  AND first_period.paid_at IS NULL
  AND second_period.paid_at IS NULL;

-- 2) Linked ProductionLog rows whose payroll record is missing,
-- belongs to a different interpreter, or does not cover its date.
-- Returns aggregate counts only; no names, account identifiers or
-- confidential payroll amounts are displayed.
SELECT COUNT(*)::bigint AS invalid_production_payroll_links
FROM public.production_logs AS production
LEFT JOIN public.payroll_records AS payroll
  ON payroll.id = production.payroll_record_id
WHERE production.payroll_record_id IS NOT NULL
  AND (
    payroll.id IS NULL
    OR payroll.interpreter_id IS DISTINCT FROM production.interpreter_id
    OR production.date < payroll.period_start
    OR production.date > payroll.period_end
  );

-- 3) Linked, still-unsettled ProductionLogs that refer to a payroll
-- record no longer pending (or already carrying paid_at). These
-- remain non-editable through automatic minute reconciliation.
SELECT COUNT(*)::bigint AS unsettled_production_with_locked_payroll
FROM public.production_logs AS production
JOIN public.payroll_records AS payroll
  ON payroll.id = production.payroll_record_id
WHERE production.is_settled = FALSE
  AND (
    payroll.paid_at IS NOT NULL
    OR payroll.status IS NULL
    OR payroll.status NOT IN ('PENDING', 'Pendiente')
  );
