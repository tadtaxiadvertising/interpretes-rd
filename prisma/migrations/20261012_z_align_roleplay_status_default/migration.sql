-- This migration intentionally sorts after 20261012_reconcile_production_runtime.
-- The reconciliation migration must commit RoleplayStatus.DRAFT before this
-- migration uses it in data updates or as the column default.

-- Align the database default with prisma/schema.prisma after the
-- preceding migration has committed the DRAFT enum label.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.roleplay_sessions') IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.roleplay_sessions does not exist.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'RoleplayStatus'
      AND e.enumlabel = 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'Preflight failed: RoleplayStatus.DRAFT was not committed; run the schema reconciliation migration first.';
  END IF;
END
$preflight$;

-- Migrate legacy status values to labels recognized by the current Prisma enum.
-- This runs in a separate migration after DRAFT has been committed to the enum.
UPDATE public.roleplay_sessions
SET status = 'DRAFT'
WHERE status::text = 'PENDING';

ALTER TABLE public.roleplay_sessions
  ALTER COLUMN status SET DEFAULT 'DRAFT';

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'roleplay_sessions'
      AND column_name = 'status'
      AND column_default LIKE '%DRAFT%'
  ) THEN
    RAISE EXCEPTION 'Verification failed: roleplay_sessions.status default is not DRAFT';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.roleplay_sessions WHERE status::text = 'PENDING'
  ) THEN
    RAISE EXCEPTION 'Verification failed: legacy PENDING roleplay rows remain';
  END IF;
END
$verify$;

COMMIT;
