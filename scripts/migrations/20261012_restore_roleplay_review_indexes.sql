-- Reconcile the review-queue indexes that were missing from the live schema.
-- Idempotent: safe to re-run; no data or user records are modified.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.roleplay_sessions') IS NULL THEN
    RAISE EXCEPTION 'Missing public.roleplay_sessions.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='roleplay_sessions'
      AND column_name='review_started_at' AND data_type='timestamp with time zone'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='roleplay_sessions'
      AND column_name='review_priority' AND data_type='integer'
  ) THEN
    RAISE EXCEPTION 'Roleplay review columns are missing or have an unexpected type.';
  END IF;
END
$preflight$;

CREATE INDEX IF NOT EXISTS idx_roleplay_review_started_at
  ON public.roleplay_sessions (review_started_at);
CREATE INDEX IF NOT EXISTS idx_roleplay_status_review_started
  ON public.roleplay_sessions (status, review_started_at);

DO $verify$
BEGIN
  IF to_regclass('public.idx_roleplay_review_started_at') IS NULL
    OR to_regclass('public.idx_roleplay_status_review_started') IS NULL THEN
    RAISE EXCEPTION 'Roleplay review index verification failed.';
  END IF;
END
$verify$;

COMMIT;
