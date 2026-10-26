-- Prevent concurrent candidate starts from creating multiple active Roleplay sessions.
-- Historical terminal attempts remain allowed. Do not delete or rewrite existing sessions.
BEGIN;

DO $preflight$
DECLARE
  duplicate_candidate_id INTEGER;
BEGIN
  SELECT recruitment_candidate_id
    INTO duplicate_candidate_id
  FROM public.roleplay_sessions
  WHERE recruitment_candidate_id IS NOT NULL
    AND status IN ('DRAFT', 'INVITED', 'STARTED', 'IN_PROGRESS', 'PENDING', 'UNDER_REVIEW')
  GROUP BY recruitment_candidate_id
  HAVING COUNT(*) > 1
  LIMIT 1;

  IF duplicate_candidate_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot add roleplay_candidate_active_session_key: candidate % has multiple active sessions. Reconcile those sessions explicitly, then rerun this migration.',
      duplicate_candidate_id;
  END IF;
END
$preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS roleplay_candidate_active_session_key
  ON public.roleplay_sessions (recruitment_candidate_id)
  WHERE recruitment_candidate_id IS NOT NULL
    AND status IN ('DRAFT', 'INVITED', 'STARTED', 'IN_PROGRESS', 'PENDING', 'UNDER_REVIEW');

COMMIT;
