-- STAGED ONLY: requires the reservation schema. Do not apply to production
-- until the hosted storage inventory, capability lifetime and pilot are proven.
BEGIN;
CREATE TABLE public.roleplay_direct_upload_budget (
  singleton boolean PRIMARY KEY CHECK (singleton),
  max_slots integer NOT NULL CHECK (max_slots BETWEEN 0 AND 25),
  allocated_slots integer NOT NULL DEFAULT 0 CHECK (allocated_slots BETWEEN 0 AND max_slots)
);
-- Zero capacity until an operator establishes actual storage headroom.
INSERT INTO public.roleplay_direct_upload_budget(singleton,max_slots) VALUES(true,0);
CREATE TABLE public.roleplay_direct_upload_budget_charges (
  reservation_id uuid PRIMARY KEY,
  actor_user_id text NOT NULL CHECK (length(btrim(actor_user_id)) BETWEEN 1 AND 256),
  request_key uuid NOT NULL,
  slots integer NOT NULL CHECK (slots BETWEEN 1 AND 25),
  UNIQUE(actor_user_id,request_key)
);
-- Deliberately no cascading FK and no automatic refund. Deleting or expiring
-- a reservation does not prove its signed upload capability or bytes are gone.
ALTER TABLE public.roleplay_direct_upload_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roleplay_direct_upload_budget_charges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.roleplay_direct_upload_budget,public.roleplay_direct_upload_budget_charges FROM PUBLIC;
CREATE FUNCTION public.charge_roleplay_direct_upload_budget()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public
AS $charge$
DECLARE
  slot_count integer;
BEGIN
  IF NEW.status <> 'RESERVED' OR NEW.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Invalid new reservation for budget' USING ERRCODE='23514';
  END IF;
  slot_count := jsonb_array_length(NEW.items);
  -- UPDATE obtains the singleton row lock, so independent processes cannot
  -- each spend the same capacity. Failure rolls back the reservation too.
  UPDATE public.roleplay_direct_upload_budget
    SET allocated_slots=allocated_slots+slot_count
    WHERE singleton=true AND allocated_slots+slot_count<=max_slots;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Roleplay direct upload capacity unavailable' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.roleplay_direct_upload_budget_charges(reservation_id,actor_user_id,request_key,slots)
    VALUES(NEW.id,NEW.actor_user_id,NEW.request_key,slot_count);
  RETURN NEW;
END
$charge$;
REVOKE ALL ON FUNCTION public.charge_roleplay_direct_upload_budget() FROM PUBLIC;
DO $roles$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON public.roleplay_direct_upload_budget,public.roleplay_direct_upload_budget_charges FROM anon;
    REVOKE ALL ON FUNCTION public.charge_roleplay_direct_upload_budget() FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON public.roleplay_direct_upload_budget,public.roleplay_direct_upload_budget_charges FROM authenticated;
    REVOKE ALL ON FUNCTION public.charge_roleplay_direct_upload_budget() FROM authenticated;
  END IF;
END
$roles$;
-- AFTER INSERT means only a successful unique reservation consumes capacity.
-- Trigger errors abort the entire statement/transaction.
CREATE TRIGGER roleplay_direct_upload_budget_charge
  AFTER INSERT ON public.roleplay_upload_reservations
  FOR EACH ROW EXECUTE FUNCTION public.charge_roleplay_direct_upload_budget();
COMMENT ON TABLE public.roleplay_direct_upload_budget IS
  'Conservative cumulative pilot allocation: each slot reserves two 15 MiB objects; not measured hosted usage or egress.';
COMMIT;
