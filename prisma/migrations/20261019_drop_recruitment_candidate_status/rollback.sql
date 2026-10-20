-- Rollback for 20261019_drop_recruitment_candidate_status.
--
-- Recreates the legacy RecruitmentCandidate.status column with its default and
-- index. The original string values cannot be recovered (they were redundant
-- with recruitment_applications.status); every existing row will read its
-- default.
--
-- Apply with: npm run migrate -- prisma/migrations/20261019_drop_recruitment_candidate_status/rollback.sql --apply

BEGIN;

ALTER TABLE public.recruitment_candidates
  ADD COLUMN IF NOT EXISTS status varchar(255) DEFAULT 'Aplicante';

CREATE INDEX IF NOT EXISTS idx_recruitment_candidates_status
  ON public.recruitment_candidates (status);

COMMIT;
