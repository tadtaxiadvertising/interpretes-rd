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
COMMENT ON TABLE public.roleplay_final_upload_evidence IS
  'Server-only historical verification evidence for final clinical objects; not an upload authorization.';
COMMIT;
