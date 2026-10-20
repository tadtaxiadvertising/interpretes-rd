-- RoleplayResponse: enforce one response per scenario.
--
-- The application code already treats scenarioId as the natural key
-- (findFirst -> update-or-create per scenario). This migration hardens that
-- invariant at the database level so a concurrent confirm can never create a
-- duplicate response for the same scenario.
--
-- Steps:
--   1. Audit/report duplicate scenario_ids (informational SELECT).
--   2. Delete all but the newest response per scenario (keep max
--      (created_at, id); id is the cuid primary key and breaks ties).
--   3. Add the unique constraint only if it does not already exist.
--
-- Apply with: npm run migrate -- prisma/migrations/20261019_roleplay_response_unique_scenario/migration.sql --apply

BEGIN;

-- Informational: duplicates that will be removed (keep newest per scenario).
SELECT scenario_id, COUNT(*) AS copies
FROM roleplay_responses
GROUP BY scenario_id
HAVING COUNT(*) > 1
ORDER BY copies DESC;

-- Keep only the newest response per scenario.
DELETE FROM roleplay_responses rr
USING roleplay_responses keeper
WHERE rr.scenario_id = keeper.scenario_id
  AND rr.id <> keeper.id
  AND (rr.created_at, rr.id) < (keeper.created_at, keeper.id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'roleplay_responses_scenario_id_key'
      AND conrelid = 'roleplay_responses'::regclass
  ) THEN
    ALTER TABLE roleplay_responses
      ADD CONSTRAINT roleplay_responses_scenario_id_key UNIQUE (scenario_id);
  END IF;
END $$;

COMMIT;
