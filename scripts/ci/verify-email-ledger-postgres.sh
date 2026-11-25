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

# Explicit candidate/account binding fixture. No production account data.
db <<'SQL'
CREATE TABLE public.recruitment_candidates (id integer PRIMARY KEY);
CREATE TABLE public.user_profiles (id uuid PRIMARY KEY);
INSERT INTO public.recruitment_candidates VALUES (1), (2), (3);
INSERT INTO public.user_profiles VALUES ('123e4567-e89b-42d3-a456-426614174000'), ('123e4567-e89b-42d3-a456-426614174001');
SQL
db < "$root/docs/operations/proposed-candidate-account-binding.sql"
db <<'SQL'
DO $check$
DECLARE role_name text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'private_email.candidate_account_binding'::regclass) THEN
    RAISE EXCEPTION 'Binding RLS missing';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_table_privilege(role_name, 'private_email.candidate_account_binding', 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'Unexpected binding privilege: %', role_name;
    END IF;
  END LOOP;
END
$check$;
INSERT INTO private_email.candidate_account_binding(candidate_id,account_id) VALUES (1,'123e4567-e89b-42d3-a456-426614174000');
DO $check$
BEGIN
  BEGIN
    INSERT INTO private_email.candidate_account_binding(candidate_id,account_id) VALUES (2,'123e4567-e89b-42d3-a456-426614174000');
    RAISE EXCEPTION 'Same account assigned twice';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO private_email.candidate_account_binding(candidate_id,account_id) VALUES (1,'123e4567-e89b-42d3-a456-426614174001');
    RAISE EXCEPTION 'Same candidate assigned twice';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END
$check$;
UPDATE private_email.candidate_account_binding SET revoked_at=now() WHERE candidate_id=1;
SQL
assert_equal "$(db -c 'SELECT count(*) FROM private_email.candidate_account_binding WHERE revoked_at IS NULL')" 0 revoked-binding
db -c "DELETE FROM public.user_profiles WHERE id='123e4567-e89b-42d3-a456-426614174000'"
assert_equal "$(db -c 'SELECT count(*) FROM private_email.candidate_account_binding')" 0 removed-account-binding
echo 'Isolated candidate account binding checks passed.'

# Additive mailbox proof proposal; existing bindings never become verified automatically.
db < "$root/docs/operations/proposed-candidate-mailbox-proof.sql"
db <<'SQL'
INSERT INTO private_email.candidate_account_binding(candidate_id,account_id) VALUES (2,'123e4567-e89b-42d3-a456-426614174001');
UPDATE private_email.candidate_account_binding SET challenge_email='candidate@example.test', challenge_hash=repeat('a',64), challenge_issued_at=now(), challenge_expires_at=now()+interval '15 minutes' WHERE candidate_id=2;
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM private_email.candidate_account_binding WHERE mailbox_verified_at IS NOT NULL) THEN RAISE EXCEPTION 'Unexpected automatic verification'; END IF;
  BEGIN
    UPDATE private_email.candidate_account_binding SET challenge_hash='bad' WHERE candidate_id=2;
    RAISE EXCEPTION 'Invalid challenge allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$check$;
UPDATE private_email.candidate_account_binding SET verified_email=challenge_email, mailbox_verified_at=now(), challenge_email=NULL, challenge_hash=NULL, challenge_expires_at=NULL WHERE candidate_id=2 AND challenge_hash=repeat('a',64) AND challenge_expires_at>now();
SQL
assert_equal "$(db -c "SELECT count(*) FROM private_email.candidate_account_binding WHERE candidate_id=2 AND verified_email='candidate@example.test' AND mailbox_verified_at IS NOT NULL AND challenge_hash IS NULL")" 1 verified-once

# A same-mailbox challenge stays valid for all 15 minutes, even after the
# five-minute abuse cooldown. Exercise the actual UPDATE from the TypeScript
# implementation against isolated fixtures, not a separately maintained query.
db <<'SQL'
ALTER TABLE public.recruitment_candidates ADD COLUMN email text;
ALTER TABLE public.user_profiles ADD COLUMN email text, ADD COLUMN role text, ADD COLUMN interpreter_id integer;
UPDATE public.recruitment_candidates SET email='candidate@example.test' WHERE id=2;
UPDATE public.user_profiles SET email='candidate@example.test', role='candidate' WHERE id='123e4567-e89b-42d3-a456-426614174001';
UPDATE private_email.candidate_account_binding SET verified_email=NULL, mailbox_verified_at=NULL,
  challenge_email='candidate@example.test', challenge_hash=repeat('b',64),
  challenge_issued_at=now()-interval '6 minutes', challenge_expires_at=now()+interval '9 minutes' WHERE candidate_id=2;
SQL
# Substitute only the known parameter expressions with deterministic test data.
# No application or production data is read.
issue_sql="$(python3 - "$root/src/lib/email/mailbox-proof.ts" <<'PY'
import pathlib, sys
source = pathlib.Path(sys.argv[1]).read_text()
sql = source.split('const write: ChallengeWrite = tx => tx.$executeRaw`', 1)[1].split('`;', 1)[0]
for parameter, value in {
    '${binding.email}': "'candidate@example.test'",
    '${digest(token)}': "repeat('c',64)",
    '${binding.candidateId}': '2',
    '${binding.accountId}': "'123e4567-e89b-42d3-a456-426614174001'",
}.items():
    sql = sql.replace(parameter, value)
assert '${' not in sql, 'Unexpected challenge parameter'
print(sql + ';')
PY
)"
db -c "$issue_sql"
assert_equal "$(db -c "SELECT challenge_hash=repeat('b',64) FROM private_email.candidate_account_binding WHERE candidate_id=2")" t live-code-preserved
db -c "UPDATE private_email.candidate_account_binding SET challenge_issued_at=now()-interval '16 minutes', challenge_expires_at=now()-interval '1 minute' WHERE candidate_id=2"
db -c "$issue_sql"
assert_equal "$(db -c "SELECT challenge_hash=repeat('c',64) AND challenge_expires_at>now() FROM private_email.candidate_account_binding WHERE candidate_id=2")" t expired-code-replaced
echo 'Isolated mailbox code lifetime checks passed.'

# Exercise the actual pilot preflight and discovery queries on disposable data.
# The fixtures contain synthetic addresses only; no SMTP or external requests.
db <<'SQL'
CREATE TABLE public.recruitment_applications (
  id text PRIMARY KEY, candidate_id integer NOT NULL REFERENCES public.recruitment_candidates(id),
  status text NOT NULL
);
ALTER TABLE public.recruitment_events ADD COLUMN application_id text REFERENCES public.recruitment_applications(id),
  ADD COLUMN event_type text, ADD COLUMN to_status text, ADD COLUMN created_at timestamptz;
INSERT INTO public.recruitment_applications VALUES ('pilot-app',2,'APPLIED'), ('other-app',3,'APPLIED');
UPDATE public.recruitment_candidates SET email='other@example.test' WHERE id=3;
INSERT INTO public.user_profiles(id,email,role) VALUES ('123e4567-e89b-42d3-a456-426614174002','other@example.test','candidate');
INSERT INTO private_email.candidate_account_binding(candidate_id,account_id,verified_email,mailbox_verified_at)
VALUES (3,'123e4567-e89b-42d3-a456-426614174002','other@example.test',now());
INSERT INTO public.recruitment_events(id,application_id,event_type,to_status,created_at) VALUES
  ('pilot-fresh','pilot-app','APPLICATION_CREATED','APPLIED',now()-interval '1 hour'),
  ('pilot-old','pilot-app','APPLICATION_CREATED','APPLIED',now()-interval '25 hours'),
  ('pilot-before-cutover','pilot-app','APPLICATION_CREATED','APPLIED',now()-interval '3 hours'),
  ('pilot-future','pilot-app','APPLICATION_CREATED','APPLIED',now()+interval '1 hour'),
  ('pilot-wrong-state','pilot-app','INDUCTION_COMPLETED','ROLEPLAY_PENDING',now()-interval '30 minutes'),
  ('pilot-unknown-kind','pilot-app','REJECTED','APPLIED',now()-interval '30 minutes'),
  ('pilot-accepted','pilot-app','APPLICATION_CREATED','APPLIED',now()-interval '30 minutes'),
  ('other-fresh','other-app','APPLICATION_CREATED','APPLIED',now()-interval '30 minutes');
INSERT INTO private_email.recruitment_delivery(event_id,template_kind,status,claimed_at,completed_at)
VALUES ('pilot-accepted','application_received','accepted',now(),now());
SQL
# Extract one tagged query from each actual implementation. Fixture substitution
# is deterministic; any unexpected template parameter fails the test.
read_fixture_query() {
  python3 - "$root/src/lib/email/$1" <<'PY'
import pathlib, sys
source = pathlib.Path(sys.argv[1]).read_text()
sql = source.split('[]>\x60', 1)[1].split('\x60;', 1)[0]
for parameter, value in {
    '${pilot}': "'candidate@example.test'",
    '${now}': 'now()',
    '${earliest}': "(now()-interval '2 hours')",
}.items():
    sql = sql.replace(parameter, value)
assert '${' not in sql, 'Unexpected pilot parameter'
print(sql + ';')
PY
}
preflight_sql="$(read_fixture_query pilot-preflight.ts)"
discovery_sql="$(read_fixture_query recruitment-batch-discovery.ts)"
discovered_ids() {
  db -c "$discovery_sql" | cut -d '|' -f 1
}
assert_equal "$(db -c "$preflight_sql")" 't|f|t|f' pilot-code-pending
assert_equal "$(discovered_ids)" "" unverified-pilot-excluded
db -c "UPDATE private_email.candidate_account_binding SET verified_email=challenge_email, mailbox_verified_at=now(), challenge_email=NULL, challenge_hash=NULL, challenge_expires_at=NULL WHERE candidate_id=2"
assert_equal "$(db -c "$preflight_sql")" 't|t|f|f' pilot-verified
assert_equal "$(discovered_ids)" pilot-fresh pilot-only-fresh-current-unsent-event
db -c "INSERT INTO private_email.recruitment_delivery(event_id,template_kind,status,claimed_at,completed_at) VALUES ('pilot-fresh','application_received','unconfirmed',now(),now())"
assert_equal "$(db -c "$preflight_sql")" 't|t|f|t' pilot-uncertain-requires-review
assert_equal "$(discovered_ids)" "" uncertain-event-not-retried
db -c "UPDATE private_email.candidate_account_binding SET revoked_at=now() WHERE candidate_id=2"
assert_equal "$(db -c "$preflight_sql")" 'f|f|f|t' revoked-binding-not-verified
assert_equal "$(discovered_ids)" "" revoked-pilot-excluded
echo 'Isolated pilot preflight and discovery checks passed.'

# Private provider vault and quota proposals: synthetic data only.
db < "$root/docs/operations/install-email-provider-center.sql"
# A second run must fail without modifying existing tables or resetting quotas.
if db < "$root/docs/operations/install-email-provider-center.sql" >/dev/null 2>&1; then
  echo "Provider installer unexpectedly allowed reinstallation" >&2; exit 1
fi

db <<'SQL'
DO $check$
DECLARE tbl regclass; role_name text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['private_email.provider_profile'::regclass,'private_email.provider_quota'::regclass] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=tbl) THEN RAISE EXCEPTION 'Provider RLS missing'; END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF has_table_privilege(role_name,tbl,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Unexpected provider privilege'; END IF;
    END LOOP;
  END LOOP;
END
$check$;
GRANT SELECT, UPDATE ON private_email.provider_quota TO email_ledger_test_runtime;
CREATE POLICY fixture_quota_access ON private_email.provider_quota TO email_ledger_test_runtime USING (true) WITH CHECK (true);
UPDATE private_email.provider_quota SET daily_limit=1,monthly_limit=2 WHERE provider='brevo';
SQL
for role in anon authenticated service_role; do
  for table in provider_profile provider_quota; do
    if db -c "SET ROLE $role; SELECT count(*) FROM private_email.$table" >/dev/null 2>&1; then
      echo "Unexpected provider table read as $role" >&2; exit 1
    fi
  done
done
quota_sql="$(python3 - "$root/src/lib/email/provider-quota.ts" <<'PY'
import pathlib, sys
source = pathlib.Path(sys.argv[1]).read_text()
sql = source.split('const rows = await db.$queryRaw', 1)[1].split('`', 2)[1]
sql = sql.replace('${provider}', "'brevo'")
assert '${' not in sql
print(sql + ';')
PY
)"
# Two simultaneous requests compete for exactly one remaining attempt.
db -c "SET ROLE email_ledger_test_runtime; BEGIN; $quota_sql SELECT pg_sleep(1); COMMIT;" > "$workdir/quota-first" &
quota_first=$!
db -c "SET ROLE email_ledger_test_runtime; $quota_sql" > "$workdir/quota-second" &
quota_second=$!
wait "$quota_first"
wait "$quota_second"
assert_equal "$(cat "$workdir/quota-first" "$workdir/quota-second" | grep -c '^brevo$' || true)" 1 quota-single-winner
assert_equal "$(db -c "SELECT daily_used||':'||monthly_used FROM private_email.provider_quota WHERE provider='brevo'")" '1:1' quota-single-reservation
assert_equal "$(db -c "SET ROLE email_ledger_test_runtime; $quota_sql")" "" quota-daily-block
# Advance the stored buckets backward to exercise rollover independent of wall-clock month/day.
db -c "UPDATE private_email.provider_quota SET day_start=(statement_timestamp() AT TIME ZONE 'UTC')::date-1, monthly_used=2 WHERE provider='brevo'"
assert_equal "$(db -c "SET ROLE email_ledger_test_runtime; $quota_sql")" "" quota-monthly-block
db -c "UPDATE private_email.provider_quota SET month_start=(date_trunc('month',statement_timestamp() AT TIME ZONE 'UTC')-interval '1 month')::date WHERE provider='brevo'"
assert_equal "$(db -c "SET ROLE email_ledger_test_runtime; $quota_sql")" brevo quota-rollover
assert_equal "$(db -c "SELECT daily_used||':'||monthly_used FROM private_email.provider_quota WHERE provider='brevo'")" '1:1' quota-reset
assert_equal "$(db -c "SELECT daily_used||':'||monthly_used FROM private_email.provider_quota WHERE provider='resend'")" '0:0' quota-provider-isolation
echo 'Isolated provider quota and vault isolation checks passed.'

# Preferred profile selection and receipt proof (no provider calls).



db <<'SQL'
DO $check$
DECLARE role_name text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='private_email.provider_selection'::regclass) THEN RAISE EXCEPTION 'Selection RLS missing'; END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_table_privilege(role_name,'private_email.provider_selection','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Unexpected selection privilege'; END IF;
  END LOOP;
END
$check$;
INSERT INTO private_email.provider_profile(id,name,provider,sender,sealed_key,updated_by)
VALUES ('123e4567-e89b-42d3-a456-426614174000','Fixture','brevo','office@example.test','v1:'||repeat('a',90),'fixture');
SQL
selection_sql="$(python3 - "$root/src/lib/email/provider-selection.ts" <<'PY'
import pathlib, sys
source = pathlib.Path(sys.argv[1]).read_text()
sql = source.split('const rows = await db.$queryRaw', 1)[1].split('`', 2)[1]
sql = sql.replace('${id}', "'123e4567-e89b-42d3-a456-426614174000'").replace('${actor}', "'fixture'")
assert '${' not in sql
print(sql+';')
PY
)"
db -c "UPDATE private_email.provider_quota SET daily_limit=2,monthly_limit=3 WHERE provider='brevo'"
assert_equal "$(db -c "$selection_sql")" "" selection-no-test
db -c "UPDATE private_email.provider_profile SET test_accepted_at=now() WHERE name='Fixture'"
assert_equal "$(db -c "$selection_sql")" "" selection-no-receipt
db -c "UPDATE private_email.provider_profile SET receipt_confirmed_at=now(),receipt_confirmed_by='fixture' WHERE name='Fixture'"
db -c "UPDATE private_email.provider_quota SET daily_used=daily_limit WHERE provider='brevo'"
assert_equal "$(db -c "$selection_sql")" "" selection-no-quota
db -c "UPDATE private_email.provider_quota SET daily_used=0 WHERE provider='brevo'"
assert_equal "$(db -c "$selection_sql")" "123e4567-e89b-42d3-a456-426614174000" selection-verified
assert_equal "$(db -c "SELECT count(*) FROM private_email.provider_selection WHERE profile_id IS NOT NULL")" 1 singleton-selected
echo 'Isolated provider selection checks passed.'

# Verify actual claim and quota SQL rollback together, with the selected profile.
db -c "INSERT INTO public.recruitment_events(id) VALUES ('vault-rollback')"
db -c "INSERT INTO private_email.recruitment_delivery(event_id,template_kind) VALUES ('vault-rollback','application_received')"
db -c "UPDATE private_email.provider_quota SET daily_used=daily_limit WHERE provider='brevo'"
db <<SQL
BEGIN;
UPDATE private_email.recruitment_delivery SET status='sending',claimed_at=now() WHERE event_id='vault-rollback' AND status='pending';
$quota_sql
ROLLBACK;
SQL
assert_equal "$(db -c "SELECT status FROM private_email.recruitment_delivery WHERE event_id='vault-rollback'")" pending quota-rollback-pending
echo 'Isolated quota rollback check passed.'

# Local budget editor: use the actual statement, preserve consumption, audit old/new limits.
db <<'SQL'
DO $check$
DECLARE role_name text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='private_email.provider_budget_audit'::regclass) THEN RAISE EXCEPTION 'Budget audit RLS missing'; END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_table_privilege(role_name,'private_email.provider_budget_audit','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Unexpected budget audit privilege'; END IF;
  END LOOP;
END
$check$;
UPDATE private_email.provider_quota SET daily_limit=50,monthly_limit=1000,daily_used=3,monthly_used=7 WHERE provider='brevo';
SQL
budget_sql="$(python3 - "$root/src/lib/email/provider-budget.ts" <<'PY'
import pathlib, sys
source = pathlib.Path(sys.argv[1]).read_text()
sql = source.split('const rows = await db.$queryRaw', 1)[1].split('`', 2)[1]
for parameter, value in {
    '${provider}': "'brevo'",
    '${dailyLimit}': '2',
    '${monthlyLimit}': '5',
    '${actor}': "'fixture'",
}.items():
    sql = sql.replace(parameter, value)
assert '${' not in sql
print(sql+';')
PY
)"
assert_equal "$(db -c "$budget_sql")" brevo budget-update
assert_equal "$(db -c "SELECT daily_limit||':'||monthly_limit||':'||daily_used||':'||monthly_used FROM private_email.provider_quota WHERE provider='brevo'")" '2:5:3:7' budget-preserves-usage
assert_equal "$(db -c "SELECT old_daily_limit||':'||old_monthly_limit||':'||new_daily_limit||':'||new_monthly_limit||':'||changed_by FROM private_email.provider_budget_audit WHERE provider='brevo'")" '50:1000:2:5:fixture' budget-audit
assert_equal "$(db -c "$quota_sql")" "" reduced-budget-blocks-reservation
for role in anon authenticated service_role; do
  if db -c "SET ROLE $role; SELECT count(*) FROM private_email.provider_budget_audit" >/dev/null 2>&1; then
    echo "Unexpected budget audit read as $role" >&2; exit 1
  fi
done
echo 'Isolated provider budget update and audit checks passed.'

# Retirement and replacement: actual retirement SQL, selection cleared atomically.
db -c "UPDATE private_email.provider_quota SET daily_limit=50,monthly_limit=1000 WHERE provider='brevo'"
assert_equal "$(db -c "$selection_sql")" "123e4567-e89b-42d3-a456-426614174000" profile-selected-before-retirement
retire_sql="$(python3 - "$root/src/lib/email/provider-lifecycle.ts" <<'PY'
import pathlib, sys
source = pathlib.Path(sys.argv[1]).read_text()
body = source.split('export async function retireProviderProfile', 1)[1].split('export async function replaceProviderProfile', 1)[0]
parts = body.split('`')
queries = [parts[1], parts[3], parts[5]]
for sql in queries:
    sql = sql.replace('${id}', "'123e4567-e89b-42d3-a456-426614174000'").replace('${actor}', "'fixture'")
    assert '${' not in sql
    print(sql+';')
PY
)"
db -c "BEGIN; $retire_sql COMMIT;"
assert_equal "$(db -c "SELECT count(*) FROM private_email.provider_selection WHERE profile_id IS NULL")" 1 retired-selection-cleared
assert_equal "$(db -c "SELECT count(*) FROM private_email.provider_profile WHERE retired_at IS NOT NULL AND retired_by='fixture' AND receipt_confirmed_at IS NOT NULL")" 1 historical-proof-retained
assert_equal "$(db -c "$selection_sql")" "" retired-selection-blocked
assert_equal "$(db -c "SELECT daily_used||':'||monthly_used FROM private_email.provider_quota WHERE provider='brevo'")" '3:7' retirement-preserves-usage
db <<'SQL'
INSERT INTO private_email.provider_profile(id,name,provider,sender,sealed_key,updated_by,replaces_id)
VALUES ('123e4567-e89b-42d3-a456-426614174001','Replacement','brevo','new@example.test','v1:'||repeat('b',90),'fixture','123e4567-e89b-42d3-a456-426614174000');
SQL
assert_equal "$(db -c "SELECT count(*) FROM private_email.provider_profile WHERE name='Replacement' AND retired_at IS NULL AND test_accepted_at IS NULL AND receipt_confirmed_at IS NULL")" 1 replacement-requires-fresh-proof
echo 'Isolated provider lifecycle checks passed.'

# Read-only vault metadata probe must work through the actual SQL.
readiness_sql="$(python3 - "$root/src/lib/email/provider-readiness.ts" <<'PY'
import pathlib, sys
source = pathlib.Path(sys.argv[1]).read_text()
sql = source.split('const [row] = await db.$queryRaw', 1)[1].split('`', 2)[1]
assert '${' not in sql
print(sql+';')
PY
)"
assert_equal "$(db -c "$readiness_sql")" 't|t|t|t|t' provider-readiness-owner
# A non-owner with incomplete grants must not be diagnosed as ready.
assert_equal "$(db -c "SET ROLE email_ledger_test_runtime; $readiness_sql")" 't|t|t|f|t' provider-readiness-incomplete-runtime
echo 'Isolated provider readiness checks passed.'

# Add three providers without resetting existing quota rows or history.
db < "$root/docs/operations/proposed-email-provider-expansion.sql"
assert_equal "$(db -c "SELECT count(*) FROM private_email.provider_quota")" 5 expanded-quota-count
assert_equal "$(db -c "SELECT daily_used||':'||monthly_used FROM private_email.provider_quota WHERE provider='brevo'")" '3:7' expanded-preserves-brevo-usage
assert_equal "$(db -c "SELECT count(*) FROM private_email.provider_quota WHERE provider IN ('mailjet','smtp2go','mailersend') AND daily_used=0 AND monthly_used=0")" 3 expanded-initial-usage
if db -c "UPDATE private_email.provider_quota SET monthly_limit=501 WHERE provider='mailersend'" >/dev/null 2>&1; then
  echo "MailerSend cap was not enforced" >&2; exit 1
fi
db -c "INSERT INTO private_email.provider_profile(id,name,provider,sender,sealed_key,updated_by) VALUES ('123e4567-e89b-42d3-a456-426614174002','Mailjet fixture','mailjet','office@example.test','v1:'||repeat('a',90),'fixture')"
assert_equal "$(db -c "SELECT count(*) FROM private_email.provider_profile WHERE provider='mailjet'")" 1 expanded-profile
assert_equal "$(db -c "$readiness_sql")" 't|t|t|t|t' expanded-readiness
echo 'Isolated five-provider expansion checks passed.'

# When a challenge write cannot reserve quota, the challenge must roll back.
db -c "UPDATE private_email.candidate_account_binding SET revoked_at=NULL,verified_email=NULL,mailbox_verified_at=NULL,challenge_email=NULL,challenge_hash=NULL,challenge_issued_at=NULL,challenge_expires_at=NULL WHERE candidate_id=2"
db -c "UPDATE private_email.provider_quota SET daily_used=daily_limit WHERE provider='brevo'"
db <<SQL
BEGIN;
$issue_sql
$quota_sql
ROLLBACK;
SQL
assert_equal "$(db -c "SELECT challenge_hash IS NULL FROM private_email.candidate_account_binding WHERE candidate_id=2")" t challenge-quota-rollback
echo 'Isolated mailbox challenge rollback check passed.'
