-- STAGED DESIGN ONLY. Do not apply to production or prisma/migrations.
-- Hardening proposal for the EXISTING 20261121210000 migration.
-- Requires explicit rollout approval, schema verification and existing-row
-- validation. Never edit the historical migration or recreate its table.
-- The old CHECK can accept UNKNOWN when completion counters are NULL.
-- Replace that constraint atomically and align the receipt cap with the reader.
ALTER TABLE public.roleplay_creation_requests
  DROP CONSTRAINT roleplay_creation_requests_result_check,
  ADD CONSTRAINT roleplay_creation_requests_result_check CHECK (
    (status = 'IN_PROGRESS' AND cardinality(session_ids) = 0
      AND created_count IS NULL AND skipped_count IS NULL
      AND scenario_count IS NULL AND completed_at IS NULL)
    OR
    (status = 'COMPLETED' AND completed_at IS NOT NULL
      AND created_count IS NOT NULL AND created_count BETWEEN 1 AND 1000
      AND skipped_count IS NOT NULL AND skipped_count >= 0
      AND scenario_count IS NOT NULL AND scenario_count BETWEEN 1 AND 25
      AND cardinality(session_ids) = created_count
      AND array_position(session_ids, NULL) IS NULL
      AND NOT ('' = ANY(session_ids)))
  ),
  ADD CONSTRAINT roleplay_creation_requests_actor_length_check
    CHECK (length(actor_user_id) <= 256);
