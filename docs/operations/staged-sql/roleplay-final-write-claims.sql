-- STAGED ONLY. Requires roleplay-upload-reservations.sql.
-- Do not install on a live project until the rollout prerequisites are met.
BEGIN;
CREATE TABLE public.roleplay_final_write_claims (
  reservation_id uuid NOT NULL,
  slot_order integer NOT NULL CHECK (slot_order BETWEEN 0 AND 24),
  actor_user_id text NOT NULL CHECK (length(btrim(actor_user_id)) BETWEEN 1 AND 256),
  request_key uuid NOT NULL,
  reference text NOT NULL CHECK (reference IN (
    'private-base/' || reservation_id::text || '/' || slot_order::text || '.mp3',
    'private-base/' || reservation_id::text || '/' || slot_order::text || '.wav',
    'private-base/' || reservation_id::text || '/' || slot_order::text || '.webm',
    'private-base/' || reservation_id::text || '/' || slot_order::text || '.mp4'
  )),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 15728640),
  sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(reservation_id,slot_order),
  UNIQUE(reference)
);
-- No FK cascade or lease expiry: an ambiguous remote write can outlive a
-- process, transaction or reservation. Never reset/recycle a claim.
ALTER TABLE public.roleplay_final_write_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.roleplay_final_write_claims FROM PUBLIC;
DO $roles$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON public.roleplay_final_write_claims FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON public.roleplay_final_write_claims FROM authenticated;
  END IF;
END
$roles$;
CREATE FUNCTION public.guard_roleplay_final_write_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public
AS $guard$
DECLARE
  parent public.roleplay_upload_reservations%ROWTYPE;
  item jsonb;
  extension text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Final write claim cannot be recycled' USING ERRCODE='23514';
  END IF;
  SELECT * INTO parent FROM public.roleplay_upload_reservations WHERE id=NEW.reservation_id FOR UPDATE;
  IF NOT FOUND OR parent.status<>'VERIFIED' OR parent.actor_user_id<>NEW.actor_user_id
    OR parent.request_key<>NEW.request_key OR parent.expires_at<=clock_timestamp()
    OR NEW.slot_order<0 OR NEW.slot_order>=jsonb_array_length(parent.items)
    OR NEW.claimed_at<parent.created_at OR NEW.claimed_at>=parent.expires_at
    OR NEW.claimed_at>clock_timestamp() THEN
    RAISE EXCEPTION 'Invalid final write reservation' USING ERRCODE='23514';
  END IF;
  item:=parent.items->NEW.slot_order;
  extension:=CASE item->>'mime' WHEN 'audio/mpeg' THEN 'mp3' WHEN 'audio/wav' THEN 'wav'
    WHEN 'audio/webm' THEN 'webm' WHEN 'audio/mp4' THEN 'mp4' ELSE NULL END;
  IF extension IS NULL OR NEW.reference IS DISTINCT FROM ('private-base/'||parent.id::text||'/'||NEW.slot_order::text||'.'||extension)
    OR item->'order' IS DISTINCT FROM to_jsonb(NEW.slot_order)
    OR item->'sizeBytes' IS DISTINCT FROM to_jsonb(NEW.size_bytes)
    OR item->>'sha256' IS DISTINCT FROM NEW.sha256 THEN
    RAISE EXCEPTION 'Final write claim differs from reservation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$guard$;
REVOKE ALL ON FUNCTION public.guard_roleplay_final_write_claim() FROM PUBLIC;
DO $roles$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION public.guard_roleplay_final_write_claim() FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON FUNCTION public.guard_roleplay_final_write_claim() FROM authenticated;
  END IF;
END
$roles$;
CREATE TRIGGER roleplay_final_write_claim_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.roleplay_final_write_claims
  FOR EACH ROW EXECUTE FUNCTION public.guard_roleplay_final_write_claim();
COMMENT ON TABLE public.roleplay_final_write_claims IS
  'Permanent single-attempt application write fence; never release on timeout, cancellation or missing object.';
COMMIT;
