#!/usr/bin/env bash
# Never connects to application databases. Dedicated CI service only.
set -euo pipefail
: "${POSTGRES_CONTAINER:?Dedicated PostgreSQL service container required}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
db() {
  docker exec -i "$POSTGRES_CONTAINER" psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d roleplay_opening_test "$@"
}
[[ "$(db -c 'SELECT current_database()')" == roleplay_opening_test ]]
[[ "$(db -c "SELECT to_regclass('public.roleplay_sessions') IS NULL")" == t ]]
db <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE TYPE public."RoleplayStatus" AS ENUM ('DRAFT','INVITED','STARTED','IN_PROGRESS','SUBMITTED','UNDER_REVIEW','EVALUATED','PASSED','FAILED','CANCELLED','EXPIRED');
CREATE TABLE public.roleplay_sessions (
  id text PRIMARY KEY, status public."RoleplayStatus" NOT NULL DEFAULT 'DRAFT',
  current_scenario_index integer NOT NULL DEFAULT 0,
  interpreter_id integer, recruitment_candidate_id integer,
  base_audio_url text NOT NULL DEFAULT '', base_audio_path text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  review_priority integer DEFAULT 0
);
CREATE TABLE public.roleplay_scenarios (
  id text PRIMARY KEY, session_id text NOT NULL REFERENCES public.roleplay_sessions(id) ON DELETE CASCADE
);
CREATE TABLE public.roleplay_responses (
  id text PRIMARY KEY, scenario_id text NOT NULL UNIQUE REFERENCES public.roleplay_scenarios(id) ON DELETE CASCADE,
  self_score jsonb
);
INSERT INTO public.roleplay_sessions VALUES ('legacy','STARTED',0);
INSERT INTO public.roleplay_scenarios VALUES ('legacy-turn','legacy');
SQL
schema="$root/docs/operations/staged-sql/roleplay-bilingual-openings.sql"
# Catch accidentally duplicated or truncated generated SQL before executing it.
python3 - "$schema" <<'PY'
import pathlib, re, sys
source = pathlib.Path(sys.argv[1]).read_text()
for keyword in ('BEGIN;', 'COMMIT;'):
    assert len(re.findall(r'^' + re.escape(keyword) + r'\s*$', source, re.M)) == 1, f'Expected one outer {keyword}'
assert source.rstrip().endswith('COMMIT;'), 'Unexpected content after transaction'
for pattern in (r'^CREATE TABLE\s+(\S+)', r'^CREATE FUNCTION\s+(\S+)', r'^CREATE TRIGGER\s+(\S+)'):
    names = re.findall(pattern, source, re.M)
    assert names and len(names) == len(set(names)), 'Duplicate or missing schema objects'
PY
db < "$schema"
db <<'SQL'
DO $test$
DECLARE role_name text; table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['roleplay_bilingual_openings','roleplay_bilingual_opening_reservations','roleplay_bilingual_opening_reviews','roleplay_bilingual_opening_retired_paths'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || table_name)::regclass) THEN
      RAISE EXCEPTION 'RLS missing on %', table_name;
    END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF has_table_privilege(role_name, 'public.' || table_name, 'SELECT,INSERT,UPDATE,DELETE') THEN
        RAISE EXCEPTION 'Unexpected access for %', role_name;
      END IF;
    END LOOP;
  END LOOP;
END
$test$;
-- Old exercises progress normally.
INSERT INTO public.roleplay_responses VALUES ('legacy-response','legacy-turn',NULL);
UPDATE public.roleplay_sessions SET current_scenario_index=1,status='SUBMITTED' WHERE id='legacy';
INSERT INTO public.roleplay_sessions (id,status,requires_bilingual_opening)
  VALUES ('required','STARTED',true), ('other','STARTED',true);
INSERT INTO public.roleplay_scenarios VALUES ('required-turn','required');
DO $test$
BEGIN
  BEGIN
    UPDATE public.roleplay_sessions SET requires_bilingual_opening=false WHERE id='required';
    RAISE EXCEPTION 'Requirement changed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.roleplay_sessions SET current_scenario_index=1 WHERE id='required';
    RAISE EXCEPTION 'Cursor advanced';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.roleplay_sessions SET status='SUBMITTED' WHERE id='required';
    RAISE EXCEPTION 'Submission bypassed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.roleplay_responses VALUES ('required-response','required-turn',NULL);
    RAISE EXCEPTION 'Clinical response bypassed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.roleplay_scenarios SET session_id='required' WHERE id='legacy-turn';
    RAISE EXCEPTION 'Scenario moved';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.roleplay_bilingual_openings(session_id,source_audio_path,duration_sec)
      VALUES ('required','openings/required/123e4567-e89b-42d3-a456-426614174000.webm',42);
    RAISE EXCEPTION 'Unreserved opening accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$test$;
INSERT INTO public.roleplay_bilingual_opening_reservations(session_id,source_audio_path,expires_at,verification_id,verification_until)
  VALUES ('required','openings/required/123e4567-e89b-42d3-a456-426614174000.webm',
  now()+interval '10 minutes','123e4567-e89b-42d3-a456-426614174001',now()+interval '2 minutes');
DO $test$
BEGIN
  BEGIN
    INSERT INTO public.roleplay_bilingual_openings(session_id,source_audio_path,duration_sec)
      VALUES ('required','openings/required/123e4567-e89b-42d3-a456-426614174000.webm',301);
    RAISE EXCEPTION 'Invalid duration accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.roleplay_bilingual_openings(session_id,source_audio_path,duration_sec)
      VALUES ('required','openings/required/123e4567-e89b-42d3-a456-426614174002.webm',42);
    RAISE EXCEPTION 'Wrong reservation accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$test$;
INSERT INTO public.roleplay_bilingual_openings(session_id,source_audio_path,duration_sec)
  VALUES ('required','openings/required/123e4567-e89b-42d3-a456-426614174000.webm',42);
INSERT INTO public.roleplay_responses VALUES ('required-response','required-turn',NULL);
UPDATE public.roleplay_responses SET self_score='{"protocol":8}' WHERE id='required-response';
UPDATE public.roleplay_sessions SET current_scenario_index=1,status='SUBMITTED' WHERE id='required';
DO $test$
BEGIN
  BEGIN
    DELETE FROM public.roleplay_bilingual_openings WHERE session_id='required';
    RAISE EXCEPTION 'Confirmed evidence deleted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.roleplay_bilingual_openings SET duration_sec=43 WHERE session_id='required';
    RAISE EXCEPTION 'Confirmed evidence changed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$test$;
INSERT INTO public.roleplay_bilingual_opening_reviews
  (session_id,reviewer_id,english_intro,spanish_intro,professional_role,consecutive_guidance,clarity,notes)
  VALUES ('required','qa-fixture',true,false,true,true,true,'QA fixture');
DO $test$
BEGIN
  BEGIN
    INSERT INTO public.roleplay_bilingual_opening_reviews
      (session_id,reviewer_id,english_intro,spanish_intro,professional_role,consecutive_guidance,clarity)
      VALUES ('required','second-reviewer',true,true,true,true,true);
    RAISE EXCEPTION 'Duplicate opening review accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.roleplay_bilingual_opening_reviews
      (session_id,reviewer_id,english_intro,spanish_intro,professional_role,consecutive_guidance,clarity)
      VALUES ('other','qa-fixture',true,true,true,true,true);
    RAISE EXCEPTION 'Review without confirmed opening accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END
$test$;
DELETE FROM public.roleplay_sessions WHERE id='required';
DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM public.roleplay_bilingual_openings WHERE session_id='required')
    OR EXISTS (SELECT 1 FROM public.roleplay_bilingual_opening_reservations WHERE session_id='required')
    OR EXISTS (SELECT 1 FROM public.roleplay_bilingual_opening_reviews WHERE session_id='required')
  THEN RAISE EXCEPTION 'Cascade cleanup failed'; END IF;
END
$test$;
SQL
# Independent clients compete for a single reservation and then for its lease.
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
race() {
  local statement="$1"
  local second_statement="${2:-$1}"
  db -c "BEGIN; $statement SELECT pg_sleep(1); COMMIT;" > "$workdir/first" &
  local first=$!
  db -c "$second_statement" > "$workdir/second" &
  local second=$!
  wait "$first"
  wait "$second"
  [[ "$(cat "$workdir/first" "$workdir/second" | grep -c '^other$' || true)" == 1 ]]
}
reservation_sql="INSERT INTO public.roleplay_bilingual_opening_reservations(session_id,source_audio_path,expires_at)
  VALUES ('other','openings/other/123e4567-e89b-42d3-a456-426614174000.webm',now()+interval '10 minutes')
  ON CONFLICT (session_id) DO NOTHING RETURNING session_id;"
# Actual concurrent authorization requests mint different immutable UUIDs.
race "$reservation_sql" "${reservation_sql/426614174000/426614174002}"
race "UPDATE public.roleplay_bilingual_opening_reservations
  SET verification_id='123e4567-e89b-42d3-a456-426614174001', verification_until=now()+interval '2 minutes'
  WHERE session_id='other' AND (verification_until IS NULL OR verification_until <= now())
  AND expires_at >= now()+interval '2 minutes' RETURNING session_id;"
# Exercise the exact INSERT used by the new assignment helper.
assignment_sql="$(python3 - "$root/src/lib/roleplay/bilingual-opening-assignment.ts" <<'PY'
import pathlib, sys
source = pathlib.Path(sys.argv[1]).read_text()
sql = source.split('INSERT INTO public.roleplay_sessions', 1)[1].split(chr(96), 1)[0]
sql = 'INSERT INTO public.roleplay_sessions' + sql
for key, value in {
    '${id}': "'new-assignment'",
    '${data.interpreterId}': '7',
    '${data.recruitmentCandidateId}': 'NULL',
    '${data.baseAudioUrl}': "''",
    '${data.baseAudioPath ?? null}': 'NULL',
    '${data.status}': "'DRAFT'",
}.items():
    sql = sql.replace(key, value)
assert '${' not in sql, 'Unexpected assignment parameter'
print(sql + ';')
PY
)"
db -c "$assignment_sql" >/dev/null
[[ "$(db -c "SELECT requires_bilingual_opening AND status='DRAFT' AND interpreter_id=7 AND current_scenario_index=0 FROM public.roleplay_sessions WHERE id='new-assignment'")" == t ]]
db <<'SQL'
-- No deletion of an object yet: its immutable key survives retirement.
INSERT INTO public.roleplay_sessions (id,status,requires_bilingual_opening) VALUES ('discard-fixture','STARTED',true);
INSERT INTO public.roleplay_bilingual_opening_reservations(session_id,source_audio_path,expires_at)
  VALUES ('discard-fixture','openings/discard-fixture/123e4567-e89b-42d3-a456-426614174000.webm',now()+interval '10 minutes');
UPDATE public.roleplay_bilingual_opening_reservations
  SET source_audio_path='openings/discard-fixture/123e4567-e89b-42d3-a456-426614174001.webm'
  WHERE session_id='discard-fixture';
DELETE FROM public.roleplay_bilingual_opening_reservations WHERE session_id='discard-fixture';
DO $test$
BEGIN
  IF (SELECT count(*) FROM public.roleplay_bilingual_opening_retired_paths
      WHERE session_id='discard-fixture' AND cleanup_permitted AND cleanup_after >= retired_at + interval '24 hours') <> 2 THEN
    RAISE EXCEPTION 'Abandoned keys not retained';
  END IF;
  BEGIN
    INSERT INTO public.roleplay_bilingual_opening_reservations(session_id,source_audio_path,expires_at)
      VALUES ('discard-fixture','openings/discard-fixture/123e4567-e89b-42d3-a456-426614174000.webm',now()+interval '10 minutes');
    RAISE EXCEPTION 'Retired path reused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$test$;
DELETE FROM public.roleplay_sessions WHERE id='discard-fixture';
DO $test$
BEGIN
  IF (SELECT count(*) FROM public.roleplay_bilingual_opening_retired_paths WHERE session_id='discard-fixture') <> 2 THEN
    RAISE EXCEPTION 'Cleanup ledger lost on session deletion';
  END IF;
END
$test$;
SQL
db <<'SQL'
DO $test$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.roleplay_bilingual_opening_retired_paths
      WHERE session_id='required' AND NOT cleanup_permitted) THEN
    RAISE EXCEPTION 'Historical evidence not protected from cleanup';
  END IF;
END
$test$;
SQL
echo 'Isolated PostgreSQL opening checks passed.'
