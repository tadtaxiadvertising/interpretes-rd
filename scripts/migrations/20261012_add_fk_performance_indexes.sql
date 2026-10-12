-- Add covering indexes for existing foreign keys reported by Supabase advisors.
-- Idempotent: safe to re-run; no constraints or user records are changed.
BEGIN;

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='call_sessions' AND column_name='payroll_record_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='payrate_audit_log' AND column_name='interpreter_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='production_logs' AND column_name='account_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='production_logs' AND column_name='payroll_record_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='roleplay_responses' AND column_name='scenario_id'
  ) THEN
    RAISE EXCEPTION 'One or more indexed foreign-key columns are missing.';
  END IF;
END
$preflight$;

CREATE INDEX IF NOT EXISTS idx_call_sessions_payroll_record_id
  ON public.call_sessions (payroll_record_id);
CREATE INDEX IF NOT EXISTS idx_payrate_audit_log_interpreter_id
  ON public.payrate_audit_log (interpreter_id);
CREATE INDEX IF NOT EXISTS idx_production_logs_account_id
  ON public.production_logs (account_id);
CREATE INDEX IF NOT EXISTS idx_production_logs_payroll_record_id
  ON public.production_logs (payroll_record_id);
CREATE INDEX IF NOT EXISTS idx_roleplay_responses_scenario_id
  ON public.roleplay_responses (scenario_id);

DO $verify$
BEGIN
  IF to_regclass('public.idx_call_sessions_payroll_record_id') IS NULL
    OR to_regclass('public.idx_payrate_audit_log_interpreter_id') IS NULL
    OR to_regclass('public.idx_production_logs_account_id') IS NULL
    OR to_regclass('public.idx_production_logs_payroll_record_id') IS NULL
    OR to_regclass('public.idx_roleplay_responses_scenario_id') IS NULL THEN
    RAISE EXCEPTION 'Foreign-key index verification failed.';
  END IF;
END
$verify$;

COMMIT;
