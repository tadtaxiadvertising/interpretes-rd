#!/usr/bin/env bash
# Only used by the isolated GitHub Actions PostgreSQL service. No DATABASE_URL.
set -euo pipefail
: "${POSTGRES_CONTAINER:?Dedicated PostgreSQL service container required}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
db() {
  docker exec -i "$POSTGRES_CONTAINER" psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d email_ledger_test "$@"
}
assert_equal() {
  if [[ "$1" != "$2" ]]; then
    printf 'Ledger check failed: %s (expected %s, got %s)\n' "$3" "$2" "$1" >&2
    exit 1
  fi
}
# Guard against applying the proposal to a pre-existing database.
assert_equal "$(db -c "SELECT current_database()")" email_ledger_test database
assert_equal "$(db -c "SELECT count(*) FROM pg_namespace WHERE nspname = 'private_email'")" 0 fresh-schema
db <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE email_ledger_test_runtime NOLOGIN;
CREATE TABLE public.recruitment_events (id text PRIMARY KEY);
INSERT INTO public.recruitment_events VALUES ('race'), ('uncertain'), ('cascade'), ('constraints');
SQL
db < "$root/docs/operations/proposed-recruitment-email-ledger.sql"
# Check the proposed schema before granting any test-only runtime privileges.
db <<'SQL'
DO $check$
DECLARE role_name text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'private_email.recruitment_delivery'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_schema_privilege(role_name, 'private_email', 'USAGE')
      OR has_table_privilege(role_name, 'private_email.recruitment_delivery', 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'Unexpected public API role access: %', role_name;
    END IF;
  END LOOP;
END
$check$;
-- These are fixtures only, not proposed production grants.
GRANT USAGE ON SCHEMA private_email TO email_ledger_test_runtime;
GRANT SELECT, INSERT, UPDATE ON private_email.recruitment_delivery TO email_ledger_test_runtime;
CREATE POLICY fixture_runtime_access ON private_email.recruitment_delivery
  TO email_ledger_test_runtime USING (true) WITH CHECK (true);
SQL
# No public role may access the table, even through a schema-qualified query.
for role in anon authenticated service_role; do
  if db -c "SET ROLE $role; SELECT count(*) FROM private_email.recruitment_delivery" >/dev/null 2>&1; then
    echo "Unexpected ledger read as $role" >&2; exit 1
  fi
done
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
enqueue="INSERT INTO private_email.recruitment_delivery(event_id,template_kind) VALUES ('race','application_received') ON CONFLICT (event_id) DO NOTHING RETURNING event_id;"
claim="UPDATE private_email.recruitment_delivery SET status='sending', claimed_at=now() WHERE event_id='race' AND status='pending' RETURNING event_id;"
race() {
  local statement="$1"
  # First client holds the row lock; the second competes in another session.
  db -c "SET ROLE email_ledger_test_runtime; BEGIN; $statement SELECT pg_sleep(1); COMMIT;" > "$workdir/first" &
  local first=$!
  db -c "SET ROLE email_ledger_test_runtime; $statement" > "$workdir/second" &
  local second=$!
  wait "$first"
  wait "$second"
  assert_equal "$(cat "$workdir/first" "$workdir/second" | grep -c '^race$' || true)" 1 single-winner
}
race "$enqueue"
assert_equal "$(db -c "SELECT count(*) FROM private_email.recruitment_delivery WHERE event_id='race'")" 1 unique-event
race "$claim"
assert_equal "$(db -c "SELECT status FROM private_email.recruitment_delivery WHERE event_id='race'")" sending claimed-once
db <<'SQL'
SET ROLE email_ledger_test_runtime;
UPDATE private_email.recruitment_delivery SET status='accepted', completed_at=now()
  WHERE event_id='race' AND status='sending';
INSERT INTO private_email.recruitment_delivery(event_id,template_kind) VALUES ('uncertain','roleplay_ready'), ('cascade','application_received');
UPDATE private_email.recruitment_delivery SET status='sending', claimed_at=now() WHERE event_id='uncertain' AND status='pending';
UPDATE private_email.recruitment_delivery SET status='unconfirmed', completed_at=now() WHERE event_id='uncertain' AND status='sending';
RESET ROLE;
DO $check$
BEGIN
  BEGIN
    INSERT INTO private_email.recruitment_delivery(event_id,template_kind) VALUES ('constraints','invalid-template');
    RAISE EXCEPTION 'Unknown template was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO private_email.recruitment_delivery(event_id,template_kind,status) VALUES ('constraints','application_received','accepted');
    RAISE EXCEPTION 'Accepted status without timestamps was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO private_email.recruitment_delivery(event_id,template_kind) VALUES ('missing-event','application_received');
    RAISE EXCEPTION 'Orphan event was allowed';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END
$check$;
DELETE FROM public.recruitment_events WHERE id='cascade';
SQL
assert_equal "$(db -c "SET ROLE email_ledger_test_runtime; UPDATE private_email.recruitment_delivery SET status='sending', claimed_at=now() WHERE event_id='uncertain' AND status='pending' RETURNING event_id")" "" no-automatic-retry
assert_equal "$(db -c "SELECT status FROM private_email.recruitment_delivery WHERE event_id='uncertain'")" unconfirmed ambiguous-preserved
assert_equal "$(db -c "SELECT count(*) FROM private_email.recruitment_delivery WHERE event_id='cascade'")" 0 event-delete-cascade
assert_equal "$(db -c "SELECT status FROM private_email.recruitment_delivery WHERE event_id='race'")" accepted final-acceptance
echo 'Isolated PostgreSQL ledger checks passed.'
