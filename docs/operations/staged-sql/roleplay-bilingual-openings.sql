-- STAGED ONLY: do not apply automatically. Existing sessions remain exempt.
-- Validate in isolated PostgreSQL before deployment. Required sessions must
-- be created with the requirement set at INSERT; never backfill active sessions.
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
    AND source_audio_path ~ '^openings/[a-zA-Z0-9_-]{1,100}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(webm|mp4|ogg|mp3)$'
  )
);

CREATE TABLE public.roleplay_bilingual_opening_reservations (
  session_id TEXT PRIMARY KEY REFERENCES public.roleplay_sessions(id) ON DELETE CASCADE,
  source_audio_path TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ(6) NOT NULL,
  verification_id UUID,
  verification_until TIMESTAMPTZ(6),
  CONSTRAINT opening_reservation_path_check CHECK (
    split_part(source_audio_path, '/', 2) = session_id
    AND source_audio_path ~ '^openings/[a-zA-Z0-9_-]{1,100}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(webm|mp4|ogg|mp3)$'
  ),
  CONSTRAINT opening_reservation_lease_check CHECK (
    (verification_id IS NULL) = (verification_until IS NULL)
    AND (verification_until IS NULL OR verification_until <= expires_at)
  )
);

-- One independent QA rubric per confirmed opening. Written in the same
-- transaction as the existing overall QA evaluation, without changing weights.
CREATE TABLE public.roleplay_bilingual_opening_reviews (
  session_id TEXT PRIMARY KEY REFERENCES public.roleplay_bilingual_openings(session_id) ON DELETE CASCADE,
  reviewer_id TEXT NOT NULL CHECK (length(btrim(reviewer_id)) BETWEEN 1 AND 256),
  english_intro BOOLEAN NOT NULL,
  spanish_intro BOOLEAN NOT NULL,
  professional_role BOOLEAN NOT NULL,
  consecutive_guidance BOOLEAN NOT NULL,
  clarity BOOLEAN NOT NULL,
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  reviewed_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE public.roleplay_bilingual_opening_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.roleplay_bilingual_opening_reviews FROM PUBLIC;

ALTER TABLE public.roleplay_bilingual_openings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roleplay_bilingual_opening_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.roleplay_bilingual_openings, public.roleplay_bilingual_opening_reservations FROM PUBLIC;

-- These functions are invoker-security triggers, not public RPCs.
CREATE FUNCTION public.enforce_roleplay_opening_session() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $guard$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.requires_bilingual_opening IS DISTINCT FROM OLD.requires_bilingual_opening THEN
      RAISE EXCEPTION 'Opening requirement is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.requires_bilingual_opening AND (
    NEW.current_scenario_index > 0 OR NEW.status::text IN ('SUBMITTED','UNDER_REVIEW','EVALUATED','PASSED','FAILED')
  ) AND NOT EXISTS (
    SELECT 1 FROM public.roleplay_bilingual_openings WHERE session_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Opening confirmation required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER roleplay_opening_session_guard
BEFORE INSERT OR UPDATE OF requires_bilingual_opening, current_scenario_index, status
ON public.roleplay_sessions FOR EACH ROW EXECUTE FUNCTION public.enforce_roleplay_opening_session();

CREATE FUNCTION public.enforce_roleplay_opening_response() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $guard$
DECLARE owner_id text; required boolean;
BEGIN
  SELECT s.session_id INTO owner_id FROM public.roleplay_scenarios s WHERE s.id = NEW.scenario_id;
  SELECT rs.requires_bilingual_opening INTO required
    FROM public.roleplay_sessions rs WHERE rs.id = owner_id FOR UPDATE;
  IF required AND NOT EXISTS (
    SELECT 1 FROM public.roleplay_bilingual_openings WHERE session_id = owner_id
  ) THEN
    RAISE EXCEPTION 'Opening confirmation required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER roleplay_opening_response_guard
BEFORE INSERT OR UPDATE ON public.roleplay_responses
FOR EACH ROW EXECUTE FUNCTION public.enforce_roleplay_opening_response();

-- Prevent moving existing responses into a required session via a scenario
-- reassignment. Existing legacy-to-legacy moves remain unaffected.
CREATE FUNCTION public.enforce_roleplay_opening_scenario_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $guard$
BEGIN
  IF NEW.session_id IS DISTINCT FROM OLD.session_id AND EXISTS (
    SELECT 1 FROM public.roleplay_sessions
    WHERE id IN (OLD.session_id, NEW.session_id) AND requires_bilingual_opening
  ) THEN
    RAISE EXCEPTION 'Required opening scenario ownership is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER roleplay_opening_scenario_owner_guard
BEFORE UPDATE OF session_id ON public.roleplay_scenarios
FOR EACH ROW EXECUTE FUNCTION public.enforce_roleplay_opening_scenario_owner();

CREATE FUNCTION public.enforce_roleplay_opening_record() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $guard$
DECLARE owner_id text; session_row public.roleplay_sessions%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN owner_id := NEW.session_id;
  ELSE owner_id := OLD.session_id;
  END IF;
  SELECT * INTO session_row FROM public.roleplay_sessions WHERE id = owner_id FOR UPDATE;
  IF TG_OP = 'DELETE' THEN
    -- Parent deletion cascades normally; standalone evidence deletion cannot
    -- reopen a session or invalidate its recorded assessments.
    IF NOT FOUND THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Confirmed opening is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Confirmed opening is immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT FOUND OR NOT session_row.requires_bilingual_opening
    OR session_row.current_scenario_index <> 0
    OR session_row.status::text NOT IN ('STARTED','IN_PROGRESS')
    OR NOT EXISTS (
      SELECT 1 FROM public.roleplay_bilingual_opening_reservations r
      WHERE r.session_id = owner_id AND r.source_audio_path = NEW.source_audio_path
        AND r.verification_id IS NOT NULL
        AND r.verification_until > clock_timestamp() AND r.expires_at > clock_timestamp()
    ) THEN
    RAISE EXCEPTION 'Active opening verification required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER roleplay_opening_record_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.roleplay_bilingual_openings
FOR EACH ROW EXECUTE FUNCTION public.enforce_roleplay_opening_record();

REVOKE ALL ON FUNCTION public.enforce_roleplay_opening_session(), public.enforce_roleplay_opening_response(),
  public.enforce_roleplay_opening_scenario_owner(), public.enforce_roleplay_opening_record() FROM PUBLIC;
DO $opening_roles$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.roleplay_bilingual_openings, public.roleplay_bilingual_opening_reservations, public.roleplay_bilingual_opening_reviews FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON FUNCTION public.enforce_roleplay_opening_session(), public.enforce_roleplay_opening_response(), public.enforce_roleplay_opening_scenario_owner(), public.enforce_roleplay_opening_record() FROM %I', role_name);
    END IF;
  END LOOP;
END
$opening_roles$;

COMMIT;
