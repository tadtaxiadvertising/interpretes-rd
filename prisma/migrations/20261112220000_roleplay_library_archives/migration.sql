-- Reversible, metadata-only withdrawal from the administrative roleplay library.
-- Historical roleplay sessions, audio objects and evaluation records are untouched.
CREATE TABLE IF NOT EXISTS public.roleplay_library_archives (
  fingerprint VARCHAR(64) PRIMARY KEY,
  archived_at TIMESTAMPTZ,
  archived_by TEXT,
  CONSTRAINT roleplay_library_archives_fingerprint_hex
    CHECK (fingerprint ~ '^[a-f0-9]{64}$')
);

-- The application uses its privileged server-side Prisma database connection.
-- Deny direct Data API access unless a later migration introduces explicit policies.
ALTER TABLE public.roleplay_library_archives ENABLE ROW LEVEL SECURITY;
DO $
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.roleplay_library_archives FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.roleplay_library_archives FROM authenticated;
  END IF;
END
$;
