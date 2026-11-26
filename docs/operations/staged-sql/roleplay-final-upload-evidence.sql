-- STAGED ONLY. Apply after roleplay-upload-reservations.sql in an isolated
-- database first. No production deployment or backfill is authorized here.
BEGIN;
CREATE TABLE public.roleplay_final_upload_evidence (
  reservation_id UUID NOT NULL REFERENCES public.roleplay_upload_reservations(id) ON DELETE CASCADE,
  slot_order INTEGER NOT NULL CHECK (slot_order BETWEEN 0 AND 24),
  reference TEXT NOT NULL CHECK (reference ~ '^private-base/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/(0|[1-9]|1[0-9]|2[0-4])\.(mp3|wav|webm|mp4)$'),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 15728640),
  sha256 VARCHAR(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  verified_at TIMESTAMPTZ NOT NULL,
  CHECK (reference IN (
    'private-base/' || reservation_id::text || '/' || slot_order::text || '.mp3',
    'private-base/' || reservation_id::text || '/' || slot_order::text || '.wav',
    'private-base/' || reservation_id::text || '/' || slot_order::text || '.webm',
    'private-base/' || reservation_id::text || '/' || slot_order::text || '.mp4'
  )),
  PRIMARY KEY (reservation_id, slot_order)
);
ALTER TABLE public.roleplay_final_upload_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.roleplay_final_upload_evidence FROM PUBLIC;
DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.roleplay_final_upload_evidence FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.roleplay_final_upload_evidence FROM authenticated;
  END IF;
END
$roles$;
-- Defense in depth: application validation is still required. Serialize
-- append operations on the parent; final evidence is historical and immutable.
CREATE FUNCTION public.guard_roleplay_final_upload_evidence()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public
AS $guard$
DECLARE
  parent public.roleplay_upload_reservations%ROWTYPE;
  item jsonb;
  source_proof jsonb;
  extension text;
  expected_reference text;
  recorded_count integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Final audio evidence is immutable' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO parent FROM public.roleplay_upload_reservations
    WHERE id = NEW.reservation_id FOR UPDATE;
  IF NOT FOUND OR parent.status <> 'VERIFIED' OR parent.expires_at <= clock_timestamp()
      OR NEW.slot_order < 0 OR NEW.slot_order >= jsonb_array_length(parent.items) THEN
    RAISE EXCEPTION 'Invalid final evidence reservation' USING ERRCODE = '23514';
  END IF;
  item := parent.items -> NEW.slot_order;
  source_proof := parent.verified_objects -> NEW.slot_order;
  extension := CASE item->>'mime'
    WHEN 'audio/mpeg' THEN 'mp3' WHEN 'audio/wav' THEN 'wav'
    WHEN 'audio/webm' THEN 'webm' WHEN 'audio/mp4' THEN 'mp4' ELSE NULL END;
  expected_reference := 'private-base/' || parent.id::text || '/' || NEW.slot_order::text || '.' || extension;
  IF extension IS NULL OR NEW.reference IS DISTINCT FROM expected_reference
      OR item->'order' IS DISTINCT FROM to_jsonb(NEW.slot_order)
      OR item->'sizeBytes' IS DISTINCT FROM to_jsonb(NEW.size_bytes)
      OR item->>'sha256' IS DISTINCT FROM NEW.sha256
      OR item->>'path' IS DISTINCT FROM ('staging/roleplay/' || parent.id::text || '/' || NEW.slot_order::text || '.' || extension)
      OR source_proof->'order' IS DISTINCT FROM to_jsonb(NEW.slot_order)
      OR source_proof->'sizeBytes' IS DISTINCT FROM to_jsonb(NEW.size_bytes)
      OR source_proof->>'sha256' IS DISTINCT FROM NEW.sha256
      OR source_proof->>'path' IS DISTINCT FROM item->>'path'
      OR jsonb_typeof(source_proof->'verifiedAtMs') IS DISTINCT FROM 'number'
      OR NEW.verified_at < parent.created_at OR NEW.verified_at >= parent.expires_at
      OR NEW.verified_at > clock_timestamp()
      OR (source_proof->>'verifiedAtMs')::numeric < extract(epoch FROM parent.created_at)*1000
      OR (source_proof->>'verifiedAtMs')::numeric > extract(epoch FROM NEW.verified_at)*1000 THEN
    RAISE EXCEPTION 'Final evidence differs from verified source' USING ERRCODE = '23514';
  END IF;
  SELECT count(*)::integer INTO recorded_count FROM public.roleplay_final_upload_evidence
    WHERE reservation_id = NEW.reservation_id;
  IF recorded_count <> NEW.slot_order OR EXISTS (
    SELECT 1 FROM public.roleplay_final_upload_evidence
    WHERE reservation_id = NEW.reservation_id AND slot_order >= NEW.slot_order
  ) THEN
    RAISE EXCEPTION 'Final evidence must be appended in order' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$guard$;
REVOKE ALL ON FUNCTION public.guard_roleplay_final_upload_evidence() FROM PUBLIC;
DO $function_roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.guard_roleplay_final_upload_evidence() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.guard_roleplay_final_upload_evidence() FROM authenticated;
  END IF;
END
$function_roles$;
CREATE TRIGGER roleplay_final_evidence_guard
  BEFORE INSERT OR UPDATE ON public.roleplay_final_upload_evidence
  FOR EACH ROW EXECUTE FUNCTION public.guard_roleplay_final_upload_evidence();

COMMENT ON TABLE public.roleplay_final_upload_evidence IS
  'Server-only historical verification evidence for final clinical objects; not an upload authorization.';
COMMIT;
