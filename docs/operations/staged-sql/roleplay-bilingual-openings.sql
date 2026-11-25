-- STAGED ONLY: do not apply automatically. Existing sessions remain exempt.
-- Enable new medical sessions only after all upload/confirmation, recovery,
-- QA and server-side progression guards are deployed and tested.
BEGIN;

ALTER TABLE public.roleplay_sessions
  ADD COLUMN requires_bilingual_opening BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE public.roleplay_bilingual_openings (
  session_id TEXT PRIMARY KEY REFERENCES public.roleplay_sessions(id) ON DELETE CASCADE,
  source_audio_path TEXT NOT NULL UNIQUE,
  duration_sec INTEGER NOT NULL CHECK (duration_sec BETWEEN 1 AND 300),
  confirmed_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT roleplay_bilingual_openings_path_check CHECK (
    split_part(source_audio_path, '/', 2) = session_id
    AND source_audio_path ~ '^openings/[^/]+/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(webm|mp4|ogg|mp3)$'
  )
);

-- One current reservation per session. Old signed tokens cannot confirm a
-- replacement reservation, even when the provider token has not yet expired.
CREATE TABLE public.roleplay_bilingual_opening_reservations (
  session_id TEXT PRIMARY KEY REFERENCES public.roleplay_sessions(id) ON DELETE CASCADE,
  source_audio_path TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ(6) NOT NULL,
  verification_id UUID,
  verification_until TIMESTAMPTZ(6),
  CONSTRAINT opening_reservation_path_check CHECK (
    split_part(source_audio_path, '/', 2) = session_id
    AND source_audio_path ~ '^openings/[^/]+/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(webm|mp4|ogg|mp3) Signed object uploads and
-- playback must be scoped by the server to an authorized session.
ALTER TABLE public.roleplay_bilingual_openings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.roleplay_bilingual_openings FROM PUBLIC;
DO $opening_roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.roleplay_bilingual_openings FROM anon;
    REVOKE ALL ON TABLE public.roleplay_bilingual_opening_reservations FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.roleplay_bilingual_openings FROM authenticated;
    REVOKE ALL ON TABLE public.roleplay_bilingual_opening_reservations FROM authenticated;
  END IF;
END
$opening_roles$;

COMMIT;

  ),
  CONSTRAINT opening_reservation_lease_check CHECK (
    (verification_id IS NULL) = (verification_until IS NULL)
    AND (verification_until IS NULL OR verification_until <= expires_at)
  )
);
ALTER TABLE public.roleplay_bilingual_opening_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.roleplay_bilingual_opening_reservations FROM PUBLIC;

-- No browser access to confirmation records. Signed object uploads and
-- playback must be scoped by the server to an authorized session.
ALTER TABLE public.roleplay_bilingual_openings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.roleplay_bilingual_openings FROM PUBLIC;
DO $opening_roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.roleplay_bilingual_openings FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.roleplay_bilingual_openings FROM authenticated;
  END IF;
END
$opening_roles$;

COMMIT;
