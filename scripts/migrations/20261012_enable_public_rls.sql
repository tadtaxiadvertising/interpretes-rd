-- Production hardening: deny-by-default RLS for every public application table.
-- Application data access is server-side through Prisma. Keep anon/authenticated
-- without direct table grants until a table-by-table Data API access model is reviewed.
-- This does not create broad policies, revoke current grants, or alter application data.

BEGIN;

DO $enable_rls$
DECLARE
  relation_name TEXT;
BEGIN
  FOR relation_name IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      relation_name
    );
  END LOOP;
END
$enable_rls$;

DO $verify_rls$
DECLARE
  missing_count INTEGER;
BEGIN
  SELECT count(*) INTO missing_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname <> '_prisma_migrations'
    AND NOT c.relrowsecurity;

  IF missing_count <> 0 THEN
    RAISE EXCEPTION
      'RLS verification failed: % public application tables remain unprotected',
      missing_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND grantee IN ('anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION
      'Unexpected direct public-schema table grant to anon/authenticated; review permissions before deployment.';
  END IF;
END
$verify_rls$;

COMMIT;
