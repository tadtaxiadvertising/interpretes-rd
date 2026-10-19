-- Retire the legacy RecruitmentCandidate.status column.
--
-- Canonical funnel state lives on recruitment_applications.status and may only
-- transition through advanceApplication(); the legacy string was display-only
-- bookkeeping. This repo keeps RecruitmentCandidate.status and its index solely
-- for backward compatibility, which is now unnecessary.
--
-- Pre-flight audit (read-only, scripts/audit-recruitment-legacy.ts) confirmed:
--   - every candidate already has exactly one RecruitmentApplication (0 rows to
--     backfill), and
--   - no candidate carried a non-default legacy status.
--
-- Restore path: see rollback.sql in this folder.
--
-- Apply with: npm run migrate -- prisma/migrations/20261019_drop_recruitment_candidate_status/migration.sql --apply

BEGIN;

DROP INDEX IF EXISTS public.idx_recruitment_candidates_status;
ALTER TABLE public.recruitment_candidates DROP COLUMN IF EXISTS status;

COMMIT;
