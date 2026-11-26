-- STAGED ONLY. Install after reservations, final write claims, final evidence
-- and budget. Existing charges remain UNTRACKED, never eligible for release.
-- Do not enable release until all old signers are stopped and the new signer
-- is attested on every instance. No Storage deletion is performed here.
BEGIN;
ALTER TABLE public.roleplay_direct_upload_budget
  ADD COLUMN unused_release_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.roleplay_direct_upload_budget_charges
  ADD COLUMN capability_state text NOT NULL DEFAULT 'UNTRACKED'
    CHECK(capability_state IN ('UNTRACKED','UNISSUED','SIGNING_STARTED','RELEASED')),
  ADD COLUMN assignment_hash varchar(64),
  ADD CONSTRAINT roleplay_charge_assignment_hash_check CHECK (
    (capability_state='SIGNING_STARTED' AND assignment_hash IS NOT NULL AND assignment_hash ~ '^[a-f0-9]{64}
CREATE OR REPLACE FUNCTION public.charge_roleplay_direct_upload_budget()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public
AS $charge$
DECLARE slot_count integer;
BEGIN
  IF NEW.status <> 'RESERVED' OR NEW.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Invalid new reservation for budget' USING ERRCODE='23514';
  END IF;
  slot_count:=jsonb_array_length(NEW.items);
  UPDATE public.roleplay_direct_upload_budget
    SET allocated_slots=allocated_slots+slot_count
    WHERE singleton=true AND allocated_slots+slot_count<=max_slots;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Roleplay direct upload capacity unavailable' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.roleplay_direct_upload_budget_charges(reservation_id,actor_user_id,request_key,slots,capability_state)
    VALUES(NEW.id,NEW.actor_user_id,NEW.request_key,slot_count,'UNISSUED');
  RETURN NEW;
END
$charge$;
CREATE FUNCTION public.guard_roleplay_upload_capability_state()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public
AS $guard$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Upload charge cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF NEW.reservation_id IS DISTINCT FROM OLD.reservation_id OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
    OR NEW.request_key IS DISTINCT FROM OLD.request_key OR NEW.slots IS DISTINCT FROM OLD.slots
    OR NOT (OLD.capability_state='UNISSUED' AND NEW.capability_state IN ('SIGNING_STARTED','RELEASED')) THEN
    RAISE EXCEPTION 'Upload capability state cannot be recycled' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER roleplay_upload_capability_state_guard BEFORE UPDATE OR DELETE
  ON public.roleplay_direct_upload_budget_charges FOR EACH ROW EXECUTE FUNCTION public.guard_roleplay_upload_capability_state();

-- Private operator primitive; no HTTP or scheduled invocation. Lock parent
-- first, then charge, then budget. The signer CAS locks the same charge.
CREATE FUNCTION public.release_never_signed_roleplay_capacity(batch uuid)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public
AS $release$
DECLARE
  parent public.roleplay_upload_reservations%ROWTYPE;
  charge public.roleplay_direct_upload_budget_charges%ROWTYPE;
BEGIN
  SELECT * INTO parent FROM public.roleplay_upload_reservations WHERE id=batch FOR UPDATE;
  IF NOT FOUND OR parent.status NOT IN ('RESERVED','CANCELLED') OR parent.expires_at>clock_timestamp()
    OR jsonb_array_length(parent.verified_objects)<>0 OR cardinality(parent.published_session_ids)<>0 THEN
    RETURN 0;
  END IF;
  SELECT * INTO charge FROM public.roleplay_direct_upload_budget_charges WHERE reservation_id=batch FOR UPDATE;
  IF NOT FOUND OR charge.capability_state<>'UNISSUED' OR charge.actor_user_id<>parent.actor_user_id
    OR charge.request_key<>parent.request_key OR charge.slots<>jsonb_array_length(parent.items) THEN
    RETURN 0;
  END IF;
  IF EXISTS(SELECT 1 FROM public.roleplay_final_write_claims WHERE reservation_id=batch)
    OR EXISTS(SELECT 1 FROM public.roleplay_final_upload_evidence WHERE reservation_id=batch)
    OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='roleplay-audio-private'
      AND (name LIKE 'staging/roleplay/'||batch::text||'/%' OR name LIKE 'base/'||batch::text||'/%')) THEN
    RETURN 0;
  END IF;
  UPDATE public.roleplay_direct_upload_budget SET allocated_slots=allocated_slots-charge.slots
    WHERE singleton=true AND unused_release_enabled AND allocated_slots>=charge.slots;
  IF NOT FOUND THEN RETURN 0; END IF;
  UPDATE public.roleplay_direct_upload_budget_charges SET capability_state='RELEASED' WHERE reservation_id=batch;
  UPDATE public.roleplay_upload_reservations SET status='CANCELLED' WHERE id=batch;
  RETURN charge.slots;
END
$release$;
REVOKE ALL ON FUNCTION public.guard_roleplay_upload_capability_state(),public.release_never_signed_roleplay_capacity(uuid) FROM PUBLIC;
DO $roles$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION public.guard_roleplay_upload_capability_state(),public.release_never_signed_roleplay_capacity(uuid) FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON FUNCTION public.guard_roleplay_upload_capability_state(),public.release_never_signed_roleplay_capacity(uuid) FROM authenticated;
  END IF;
END
$roles$;
COMMIT;
) OR
    (capability_state<>'SIGNING_STARTED' AND assignment_hash IS NULL)
  );
CREATE OR REPLACE FUNCTION public.charge_roleplay_direct_upload_budget()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public
AS $charge$
DECLARE slot_count integer;
BEGIN
  IF NEW.status <> 'RESERVED' OR NEW.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Invalid new reservation for budget' USING ERRCODE='23514';
  END IF;
  slot_count:=jsonb_array_length(NEW.items);
  UPDATE public.roleplay_direct_upload_budget
    SET allocated_slots=allocated_slots+slot_count
    WHERE singleton=true AND allocated_slots+slot_count<=max_slots;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Roleplay direct upload capacity unavailable' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.roleplay_direct_upload_budget_charges(reservation_id,actor_user_id,request_key,slots,capability_state)
    VALUES(NEW.id,NEW.actor_user_id,NEW.request_key,slot_count,'UNISSUED');
  RETURN NEW;
END
$charge$;
CREATE FUNCTION public.guard_roleplay_upload_capability_state()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public
AS $guard$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Upload charge cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF NEW.reservation_id IS DISTINCT FROM OLD.reservation_id OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
    OR NEW.request_key IS DISTINCT FROM OLD.request_key OR NEW.slots IS DISTINCT FROM OLD.slots
    OR NOT (OLD.capability_state='UNISSUED' AND NEW.capability_state IN ('SIGNING_STARTED','RELEASED')) THEN
    RAISE EXCEPTION 'Upload capability state cannot be recycled' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER roleplay_upload_capability_state_guard BEFORE UPDATE OR DELETE
  ON public.roleplay_direct_upload_budget_charges FOR EACH ROW EXECUTE FUNCTION public.guard_roleplay_upload_capability_state();

-- Private operator primitive; no HTTP or scheduled invocation. Lock parent
-- first, then charge, then budget. The signer CAS locks the same charge.
CREATE FUNCTION public.release_never_signed_roleplay_capacity(batch uuid)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public
AS $release$
DECLARE
  parent public.roleplay_upload_reservations%ROWTYPE;
  charge public.roleplay_direct_upload_budget_charges%ROWTYPE;
BEGIN
  SELECT * INTO parent FROM public.roleplay_upload_reservations WHERE id=batch FOR UPDATE;
  IF NOT FOUND OR parent.status NOT IN ('RESERVED','CANCELLED') OR parent.expires_at>clock_timestamp()
    OR jsonb_array_length(parent.verified_objects)<>0 OR cardinality(parent.published_session_ids)<>0 THEN
    RETURN 0;
  END IF;
  SELECT * INTO charge FROM public.roleplay_direct_upload_budget_charges WHERE reservation_id=batch FOR UPDATE;
  IF NOT FOUND OR charge.capability_state<>'UNISSUED' OR charge.actor_user_id<>parent.actor_user_id
    OR charge.request_key<>parent.request_key OR charge.slots<>jsonb_array_length(parent.items) THEN
    RETURN 0;
  END IF;
  IF EXISTS(SELECT 1 FROM public.roleplay_final_write_claims WHERE reservation_id=batch)
    OR EXISTS(SELECT 1 FROM public.roleplay_final_upload_evidence WHERE reservation_id=batch)
    OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='roleplay-audio-private'
      AND (name LIKE 'staging/roleplay/'||batch::text||'/%' OR name LIKE 'base/'||batch::text||'/%')) THEN
    RETURN 0;
  END IF;
  UPDATE public.roleplay_direct_upload_budget SET allocated_slots=allocated_slots-charge.slots
    WHERE singleton=true AND unused_release_enabled AND allocated_slots>=charge.slots;
  IF NOT FOUND THEN RETURN 0; END IF;
  UPDATE public.roleplay_direct_upload_budget_charges SET capability_state='RELEASED' WHERE reservation_id=batch;
  UPDATE public.roleplay_upload_reservations SET status='CANCELLED' WHERE id=batch;
  RETURN charge.slots;
END
$release$;
REVOKE ALL ON FUNCTION public.guard_roleplay_upload_capability_state(),public.release_never_signed_roleplay_capacity(uuid) FROM PUBLIC;
DO $roles$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION public.guard_roleplay_upload_capability_state(),public.release_never_signed_roleplay_capacity(uuid) FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON FUNCTION public.guard_roleplay_upload_capability_state(),public.release_never_signed_roleplay_capacity(uuid) FROM authenticated;
  END IF;
END
$roles$;
COMMIT;
