#!/usr/bin/env bash
set -euo pipefail
# Disposable CI container only. Never consume DATABASE_URL or hosted credentials.
: "${POSTGRES_CONTAINER:?Set the disposable CI service container ID}"
db=roleplay_topics_test
psql_ci() {
  docker exec -i "$POSTGRES_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$db" "$@"
}
psql_ci <<'SQL'
DO $$ BEGIN
  IF current_database() <> 'roleplay_topics_test' OR to_regclass('public.roleplay_library_topics') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable test database';
  END IF;
END $$;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE fixture_owner NOLOGIN;
CREATE ROLE fixture_app NOLOGIN;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, fixture_app;
GRANT USAGE, CREATE ON SCHEMA public TO fixture_owner;
-- Simulate legacy Supabase default privileges; proposed SQL must revoke them.
ALTER DEFAULT PRIVILEGES FOR ROLE fixture_owner IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
SQL
# Rehearse the exact staged SQL in a transaction, replacing only its final
# COMMIT with ROLLBACK. Reject wrapper drift before sending anything to psql.
staged=docs/staged-sql/roleplay-library-editorial-topics.sql
python3 - "$staged" <<'PY'
import pathlib, sys
lines = pathlib.Path(sys.argv[1]).read_text().splitlines()
statements = [line.strip() for line in lines if line.strip() and not line.lstrip().startswith('--')]
assert statements[0] == 'BEGIN;' and statements[-1] == 'COMMIT;'
assert sum(line.upper() in ('BEGIN;', 'COMMIT;', 'ROLLBACK;') for line in statements) == 2
PY
{
  printf 'SET ROLE fixture_owner;\n'
  sed 's/^COMMIT;$/ROLLBACK;/' "$staged"
  printf '\nRESET ROLE;\n'
} | psql_ci
psql_ci <<'SQL'
DO $ BEGIN
  IF to_regclass('public.roleplay_library_topics') IS NOT NULL THEN
    RAISE EXCEPTION 'Schema survived explicit rollback';
  END IF;
END $;
SQL
# Force a failure after CREATE/ALTER/REVOKE but before commit; ON_ERROR_STOP
# must terminate the session with an open transaction, which rolls back.
if {
  printf 'SET ROLE fixture_owner;\n'
  sed '/^COMMIT;$/i SELECT 1 / 0;' "$staged"
} | psql_ci > /dev/null 2>&1; then
  echo 'Expected late installation failure was not observed' >&2
  exit 1
fi
psql_ci <<'SQL'
DO $ BEGIN
  IF to_regclass('public.roleplay_library_topics') IS NOT NULL THEN
    RAISE EXCEPTION 'Partial schema survived failed installation';
  END IF;
END $;
SQL
# Install unchanged reviewed SQL only inside the disposable CI database.
{
  printf 'SET ROLE fixture_owner;\n'
  cat docs/staged-sql/roleplay-library-editorial-topics.sql
  printf '\nRESET ROLE;\n'
} | psql_ci
psql_ci <<'SQL'
DO $$
DECLARE r text; p text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.roleplay_library_topics'::regclass) THEN
    RAISE EXCEPTION 'RLS disabled';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','fixture_app'] LOOP
    FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege(r, 'public.roleplay_library_topics', p) THEN
        RAISE EXCEPTION 'Unexpected permission for %: %', r, p;
      END IF;
    END LOOP;
  END LOOP;
END $$;
SET ROLE fixture_owner;
DO $$
DECLARE f text := repeat('a',64); t text; s text;
BEGIN
  INSERT INTO public.roleplay_library_topics(fingerprint,topic,subtopic) VALUES(f,'medical','pharmacy');
  INSERT INTO public.roleplay_library_topics(fingerprint,topic,subtopic) VALUES(f,'finance','banking')
    ON CONFLICT(fingerprint) DO NOTHING;
  SELECT topic,subtopic INTO t,s FROM public.roleplay_library_topics WHERE fingerprint=f;
  IF t IS DISTINCT FROM 'medical' OR s IS DISTINCT FROM 'pharmacy' THEN
    RAISE EXCEPTION 'Initial save overwrote existing category';
  END IF;
  INSERT INTO public.roleplay_library_topics(fingerprint,topic,subtopic) VALUES(f,'finance','banking')
    ON CONFLICT(fingerprint) DO UPDATE SET topic=EXCLUDED.topic,subtopic=EXCLUDED.subtopic,updated_at=now();
  SELECT topic,subtopic INTO t,s FROM public.roleplay_library_topics WHERE fingerprint=f;
  IF t IS DISTINCT FROM 'finance' OR s IS DISTINCT FROM 'banking' THEN
    RAISE EXCEPTION 'Editorial upsert failed';
  END IF;
  BEGIN
    INSERT INTO public.roleplay_library_topics(fingerprint,topic,subtopic) VALUES('invalid','medical','pharmacy');
    RAISE EXCEPTION 'Invalid fingerprint accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  DELETE FROM public.roleplay_library_topics WHERE fingerprint=f;
  IF EXISTS(SELECT 1 FROM public.roleplay_library_topics WHERE fingerprint=f) THEN
    RAISE EXCEPTION 'Clear category failed';
  END IF;
  INSERT INTO public.roleplay_library_topics(fingerprint,topic,subtopic) VALUES(f,'medical','pharmacy');
END $$;
RESET ROLE;
SET ROLE service_role;
DO $$ BEGIN
  BEGIN
    PERFORM count(*) FROM public.roleplay_library_topics;
    RAISE EXCEPTION 'BYPASSRLS role accessed table without grant';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
-- Demonstrate that ordinary DML grants alone do not give a non-owner RLS access.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roleplay_library_topics TO fixture_app;
SET ROLE fixture_app;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.roleplay_library_topics) THEN
    RAISE EXCEPTION 'Non-owner bypassed RLS without policy';
  END IF;
  BEGIN
    INSERT INTO public.roleplay_library_topics(fingerprint,topic,subtopic)
      VALUES(repeat('b',64),'medical','pharmacy');
    RAISE EXCEPTION 'Non-owner inserted without policy';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
-- This role and policy are test fixtures only, NOT deployment instructions.
CREATE POLICY fixture_app_only ON public.roleplay_library_topics
  FOR ALL TO fixture_app USING (true) WITH CHECK (true);
SET ROLE fixture_app;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.roleplay_library_topics WHERE fingerprint=repeat('a',64)) THEN
    RAISE EXCEPTION 'Dedicated server role could not read';
  END IF;
  INSERT INTO public.roleplay_library_topics(fingerprint,topic,subtopic) VALUES(repeat('b',64),'medical','pharmacy');
  UPDATE public.roleplay_library_topics SET subtopic='emergency' WHERE fingerprint=repeat('b',64);
  IF NOT EXISTS(SELECT 1 FROM public.roleplay_library_topics WHERE fingerprint=repeat('b',64) AND subtopic='emergency') THEN
    RAISE EXCEPTION 'Dedicated server role could not update';
  END IF;
  DELETE FROM public.roleplay_library_topics WHERE fingerprint=repeat('b',64);
  IF EXISTS(SELECT 1 FROM public.roleplay_library_topics WHERE fingerprint=repeat('b',64)) THEN
    RAISE EXCEPTION 'Dedicated server role could not delete';
  END IF;
END $$;
RESET ROLE;
SQL
# Exercise the same read-only catalog query used by the runtime operator command.
check_readiness() {
  local role="$1" expected="$2"
  {
    printf 'SET ROLE %s; BEGIN READ ONLY;\n' "$role"
    cat scripts/ci/roleplay-library-topics-readiness.sql
    printf '\nROLLBACK; RESET ROLE;\n'
  } | psql_ci -qAt | python3 -c '
import json, sys
result = json.load(sys.stdin)
assert result["tableExists"] and result["rlsEnabled"] and result["columnsMatch"]
assert result["fingerprintPrimaryKey"] and result["externalRolesPresent"]
assert result["externalAccessDenied"]
expected = sys.argv[1]
assert result["serverDmlGranted"] == (expected != "denied")
assert result["rlsActiveForServer"] == (expected == "policy")
' "$expected"
}
check_readiness fixture_owner owner
check_readiness fixture_app policy
check_readiness service_role denied
# An accidental duplicate installation must fail closed, not reset saved rows.
if {
  printf 'SET ROLE fixture_owner;\n'
  cat "$staged"
} | psql_ci > /dev/null 2>&1; then
  echo 'Unexpected success on duplicate schema installation' >&2
  exit 1
fi
psql_ci <<'SQL'
DO $ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.roleplay_library_topics
    WHERE fingerprint=repeat('a',64) AND topic='medical' AND subtopic='pharmacy'
  ) THEN
    RAISE EXCEPTION 'Duplicate installation changed saved category';
  END IF;
END $;
SQL
check_readiness fixture_owner owner
echo 'Isolated editorial topics SQL checks passed'
