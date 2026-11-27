-- STAGED DESIGN ONLY. Do not apply to production or prisma/migrations.
-- Requires explicit schema rollout approval and runtime verification.
CREATE TABLE public.roleplay_creation_requests (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL CHECK (length(btrim(actor_user_id)) BETWEEN 1 AND 256),
  request_key UUID NOT NULL,
  payload_hash VARCHAR(64) NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  status VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
  session_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_count INTEGER,
  skipped_count INTEGER,
  scenario_count INTEGER,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ(6),
  CONSTRAINT roleplay_creation_requests_actor_key UNIQUE (actor_user_id, request_key),
  CONSTRAINT roleplay_creation_requests_receipt_check CHECK (
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
  )
);
CREATE INDEX idx_roleplay_creation_requests_status_created
  ON public.roleplay_creation_requests (status, created_at);
ALTER TABLE public.roleplay_creation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.roleplay_creation_requests FROM PUBLIC;
DO $creation_roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.roleplay_creation_requests FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.roleplay_creation_requests FROM authenticated;
  END IF;
END
$creation_roles$;
COMMENT ON TABLE public.roleplay_creation_requests IS
  'Staged server-only creation receipt ledger; not an authorization capability.';
