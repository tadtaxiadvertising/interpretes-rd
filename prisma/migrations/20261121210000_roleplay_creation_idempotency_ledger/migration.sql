-- Additive, server-only ledger for *future* Roleplay creation idempotency.
-- It does not alter current sessions, assignments or audio objects.
-- No runtime will read/write this table until a separate, reviewed activation.
CREATE TABLE IF NOT EXISTS public.roleplay_creation_requests (
  id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  request_key UUID NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
  session_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_count INTEGER,
  skipped_count INTEGER,
  scenario_count INTEGER,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ(6),
  CONSTRAINT roleplay_creation_requests_pkey PRIMARY KEY (id),
  CONSTRAINT roleplay_creation_requests_actor_key UNIQUE (actor_user_id, request_key),
  CONSTRAINT roleplay_creation_requests_actor_nonempty CHECK (length(btrim(actor_user_id)) > 0),
  CONSTRAINT roleplay_creation_requests_payload_hex CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT roleplay_creation_requests_status_check CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
  CONSTRAINT roleplay_creation_requests_result_check CHECK (
    (
      status = 'IN_PROGRESS'
      AND completed_at IS NULL
      AND created_count IS NULL
      AND skipped_count IS NULL
      AND scenario_count IS NULL
      AND cardinality(session_ids) = 0
    ) OR (
      status = 'COMPLETED'
      AND completed_at IS NOT NULL
      AND created_count BETWEEN 1 AND 100000
      AND skipped_count >= 0
      AND scenario_count BETWEEN 1 AND 25
      AND cardinality(session_ids) = created_count
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_roleplay_creation_requests_status_created
  ON public.roleplay_creation_requests (status, created_at);

-- A request ledger must never be exposed through Supabase Data API.
-- Prisma runs with an authorized, server-only PostgreSQL connection.
ALTER TABLE public.roleplay_creation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.roleplay_creation_requests FROM PUBLIC;
DO $roleplay_creation_idem$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.roleplay_creation_requests FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.roleplay_creation_requests FROM authenticated;
  END IF;
END
$roleplay_creation_idem$;

-- Non-destructive rollback (only if no writes have occurred):
-- DROP TABLE public.roleplay_creation_requests;
