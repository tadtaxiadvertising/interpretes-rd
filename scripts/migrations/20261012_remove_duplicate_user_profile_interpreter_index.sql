-- Remove one exact duplicate unique index while keeping the equivalent index.
-- This preserves uniqueness on interpreter_id and removes redundant write/storage overhead.
BEGIN;

DO $preflight$
DECLARE
  candidate_definition TEXT;
  remaining_definition TEXT;
BEGIN
  SELECT indexdef INTO remaining_definition
  FROM pg_indexes
  WHERE schemaname='public'
    AND tablename='user_profiles'
    AND indexname='user_profiles_interpreter_id_key';

  IF remaining_definition IS NULL
     OR remaining_definition <> 'CREATE UNIQUE INDEX user_profiles_interpreter_id_key ON public.user_profiles USING btree (interpreter_id) WHERE (interpreter_id IS NOT NULL)' THEN
    RAISE EXCEPTION 'Expected unique interpreter_id index missing or definition differs; no index dropped.';
  END IF;

  IF to_regclass('public.idx_user_profiles_interpreter') IS NOT NULL THEN
    SELECT indexdef INTO candidate_definition
    FROM pg_indexes
    WHERE schemaname='public'
      AND tablename='user_profiles'
      AND indexname='idx_user_profiles_interpreter';

    IF candidate_definition <> 'CREATE UNIQUE INDEX idx_user_profiles_interpreter ON public.user_profiles USING btree (interpreter_id) WHERE (interpreter_id IS NOT NULL)' THEN
      RAISE EXCEPTION 'Duplicate index candidate differs from reviewed definition; no index dropped.';
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conindid = to_regclass('public.idx_user_profiles_interpreter')
    ) THEN
      RAISE EXCEPTION 'Candidate index backs a constraint; no index dropped.';
    END IF;
  END IF;
END
$preflight$;

DROP INDEX IF EXISTS public.idx_user_profiles_interpreter;

DO $verify$
BEGIN
  IF to_regclass('public.user_profiles_interpreter_id_key') IS NULL THEN
    RAISE EXCEPTION 'Verification failed: unique interpreter_id index was not preserved.';
  END IF;
  IF to_regclass('public.idx_user_profiles_interpreter') IS NOT NULL THEN
    RAISE EXCEPTION 'Verification failed: duplicate index still exists.';
  END IF;
END
$verify$;

COMMIT;
