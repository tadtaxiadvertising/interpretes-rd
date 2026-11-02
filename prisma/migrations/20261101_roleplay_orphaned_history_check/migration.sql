-- Permit retained Roleplay sessions to become unowned historical evidence
-- after their interpreter is permanently deleted.
--
-- The original XOR constraint required exactly one owner. ON DELETE SET NULL
-- therefore made interpreter deletion impossible for every linked session.
-- We retain the exclusivity guarantee (never two owners) but permit zero owners.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.roleplay_sessions') IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.roleplay_sessions does not exist.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.roleplay_sessions
    WHERE interpreter_id IS NOT NULL
      AND recruitment_candidate_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot relax Roleplay ownership constraint: sessions with both interpreter_id and recruitment_candidate_id exist. Reconcile them explicitly first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.roleplay_sessions'::regclass
      AND conname = 'roleplay_session_xor_subject'
      AND contype = 'c'
  ) THEN
    RAISE EXCEPTION
      'Expected constraint roleplay_session_xor_subject was not found. Inspect the production schema before applying this migration.';
  END IF;
END
$preflight$;

ALTER TABLE public.roleplay_sessions
  DROP CONSTRAINT roleplay_session_xor_subject;

ALTER TABLE public.roleplay_sessions
  ADD CONSTRAINT roleplay_session_at_most_one_subject
  CHECK (
    ((interpreter_id IS NOT NULL)::integer
      + (recruitment_candidate_id IS NOT NULL)::integer) <= 1
  );

COMMIT;
