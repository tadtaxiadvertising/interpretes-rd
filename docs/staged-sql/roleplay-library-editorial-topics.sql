-- PROPOSAL ONLY: outside automatic Prisma migration discovery.
-- Review grants and test with the actual application database role in isolation.
-- Do not execute against production before rollout approval.
BEGIN;
CREATE TABLE public.roleplay_library_topics (
  fingerprint varchar(64) PRIMARY KEY CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  topic varchar(40) NOT NULL,
  subtopic varchar(40) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.roleplay_library_topics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.roleplay_library_topics FROM PUBLIC, anon, authenticated, service_role;
-- No Data API access. A reviewed server-only application role must have
-- the required SELECT/INSERT/UPDATE/DELETE and RLS access before activation.
COMMIT;
