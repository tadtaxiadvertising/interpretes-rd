-- Explicit fresh installation only; run in a reviewed administrative SQL session.
-- No changes to existing recruitment ledger, Supabase Auth or runtime flags.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
DECLARE obj text; role_name text;
BEGIN
  IF to_regnamespace('private_email') IS NULL OR
    to_regclass('private_email.recruitment_delivery') IS NULL OR
    to_regclass('private_email.candidate_account_binding') IS NULL THEN
    RAISE EXCEPTION 'Existing private_email foundation required';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.oid IN
    ('private_email.recruitment_delivery'::regclass,'private_email.candidate_account_binding'::regclass)
    AND (NOT c.relrowsecurity OR pg_get_userbyid(c.relowner) <> current_user)) THEN
    RAISE EXCEPTION 'Run as existing private table owner with RLS intact';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_schema_privilege(role_name,'private_email','USAGE,CREATE') THEN
      RAISE EXCEPTION 'Unexpected API schema access: %',role_name;
    END IF;
  END LOOP;
  FOREACH obj IN ARRAY ARRAY['provider_profile','provider_quota','provider_selection','provider_budget_audit','provider_budget_audit_id_seq'] LOOP
    IF to_regclass('private_email.' || obj) IS NOT NULL THEN
      RAISE EXCEPTION 'Existing or partial installation: %; inspect before proceeding',obj;
    END IF;
  END LOOP;
END
$guard$;

-- SOURCE: docs/operations/proposed-email-provider-vault.sql
-- PROPOSED ONLY. Apply separately after review; not part of automated deployment.
-- Run as the owner of private_email. Grant runtime access only to the reviewed
-- dedicated server-side database role, never the Supabase API roles.

CREATE TABLE private_email.provider_profile (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  provider text NOT NULL CHECK (provider IN ('brevo', 'resend')),
  sender text NOT NULL CHECK (length(sender) BETWEEN 1 AND 254),
  reply_to text NOT NULL DEFAULT '' CHECK (length(reply_to) <= 254),
  sealed_key text NOT NULL CHECK (length(sealed_key) BETWEEN 62 AND 1200 AND sealed_key LIKE 'v1:%'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL
);
ALTER TABLE private_email.provider_profile ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private_email.provider_profile FROM PUBLIC, anon, authenticated, service_role;
-- No public policies. Owner access is intentional; for a non-owner runtime
-- role, explicitly grant SELECT, INSERT and a role-specific policy after review.

-- No changes to the existing delivery ledger or active provider.

-- SOURCE: docs/operations/proposed-email-provider-quota.sql
-- PROPOSED ONLY. Install after provider vault, in an explicitly reviewed DB session.
-- UTC buckets are local budgets, not provider balances. No paid overage is enabled.

CREATE TABLE private_email.provider_quota (
  provider text PRIMARY KEY CHECK (provider IN ('brevo','resend')),
  daily_limit integer NOT NULL CHECK (daily_limit BETWEEN 1 AND 300),
  monthly_limit integer NOT NULL CHECK (monthly_limit BETWEEN 1 AND 9300),
  day_start date NOT NULL,
  month_start date NOT NULL CHECK (extract(day FROM month_start) = 1),
  daily_used integer NOT NULL DEFAULT 0 CHECK (daily_used >= 0),
  monthly_used integer NOT NULL DEFAULT 0 CHECK (monthly_used >= 0),
  CHECK (provider <> 'resend' OR (daily_limit <= 100 AND monthly_limit <= 3000))
);
ALTER TABLE private_email.provider_quota ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private_email.provider_quota FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO private_email.provider_quota(provider,daily_limit,monthly_limit,day_start,month_start)
SELECT p, 50, 1000, (now() AT TIME ZONE 'UTC')::date,
  date_trunc('month',now() AT TIME ZONE 'UTC')::date
FROM (VALUES ('brevo'),('resend')) AS providers(p);
-- Owner access intentional; review dedicated runtime SELECT/UPDATE policy if needed.

-- SOURCE: docs/operations/proposed-email-provider-selection.sql
-- PROPOSED ONLY. Apply after provider vault and quota proposals.

ALTER TABLE private_email.provider_profile
  ADD COLUMN test_accepted_at timestamptz,
  ADD COLUMN receipt_confirmed_at timestamptz,
  ADD COLUMN receipt_confirmed_by text,
  ADD CONSTRAINT provider_receipt_proof CHECK (
    (receipt_confirmed_at IS NULL AND receipt_confirmed_by IS NULL)
    OR (receipt_confirmed_at IS NOT NULL AND receipt_confirmed_by IS NOT NULL
      AND test_accepted_at IS NOT NULL AND receipt_confirmed_at >= test_accepted_at)
  );
CREATE TABLE private_email.provider_selection (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  profile_id uuid REFERENCES private_email.provider_profile(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by text
);
INSERT INTO private_email.provider_selection(singleton) VALUES (true);
ALTER TABLE private_email.provider_selection ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private_email.provider_selection FROM PUBLIC, anon, authenticated, service_role;
-- The saved preference is not yet connected to automatic recruitment dispatch.

-- SOURCE: docs/operations/proposed-email-provider-budget-audit.sql
-- PROPOSED ONLY. Install after provider quota, with reviewed runtime permissions.

CREATE TABLE private_email.provider_budget_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL REFERENCES private_email.provider_quota(provider),
  old_daily_limit integer NOT NULL CHECK (old_daily_limit BETWEEN 1 AND 300),
  old_monthly_limit integer NOT NULL CHECK (old_monthly_limit BETWEEN 1 AND 9300),
  new_daily_limit integer NOT NULL CHECK (new_daily_limit BETWEEN 1 AND 300),
  new_monthly_limit integer NOT NULL CHECK (new_monthly_limit BETWEEN 1 AND 9300),
  changed_by text NOT NULL CHECK (length(changed_by) BETWEEN 1 AND 255),
  changed_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
ALTER TABLE private_email.provider_budget_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private_email.provider_budget_audit FROM PUBLIC, anon, authenticated, service_role;
-- Dedicated runtime role needs INSERT and SELECT of provider for RETURNING.
-- No UPDATE or DELETE policy/grant for the audit table. Existing quota limits
-- and usage counters are unchanged. Owner access is intentional.

-- SOURCE: docs/operations/proposed-email-provider-lifecycle.sql
-- PROPOSED ONLY. Apply after vault, quota, selection and budget audit.

ALTER TABLE private_email.provider_profile
  ADD COLUMN retired_at timestamptz,
  ADD COLUMN retired_by text,
  ADD COLUMN replaces_id uuid REFERENCES private_email.provider_profile(id) ON DELETE RESTRICT,
  ADD CONSTRAINT provider_retirement_pair CHECK (
    (retired_at IS NULL AND retired_by IS NULL) OR
    (retired_at IS NOT NULL AND retired_by IS NOT NULL)
  ),
  ADD CONSTRAINT provider_not_self_replacement CHECK (replaces_id IS DISTINCT FROM id),
  ADD CONSTRAINT provider_single_replacement UNIQUE (replaces_id);
-- Existing profiles remain unchanged. No DELETE grant or automatic activation.
-- RLS and prior restrictions remain in effect.

-- Validate isolation and empty initial state before committing.
DO $guard$
DECLARE obj text; role_name text; tbl regclass;
BEGIN
  FOREACH obj IN ARRAY ARRAY['provider_profile','provider_quota','provider_selection','provider_budget_audit'] LOOP
    tbl := to_regclass('private_email.' || obj);
    IF tbl IS NULL OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=tbl AND relrowsecurity AND pg_get_userbyid(relowner)=current_user) THEN
      RAISE EXCEPTION 'Missing or insecure table: %',obj;
    END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF has_table_privilege(role_name,tbl,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
        RAISE EXCEPTION 'Unexpected API table access: % / %',role_name,obj;
      END IF;
    END LOOP;
  END LOOP;
  REVOKE ALL ON SEQUENCE private_email.provider_budget_audit_id_seq FROM PUBLIC, anon, authenticated, service_role;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_sequence_privilege(role_name,'private_email.provider_budget_audit_id_seq','USAGE,SELECT,UPDATE') THEN
      RAISE EXCEPTION 'Unexpected audit sequence access: %',role_name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM private_email.provider_quota WHERE daily_limit=50 AND monthly_limit=1000 AND daily_used=0 AND monthly_used=0) <> 2
    OR (SELECT count(*) FROM private_email.provider_selection WHERE singleton AND profile_id IS NULL) <> 1
    OR EXISTS (SELECT 1 FROM private_email.provider_profile)
    OR EXISTS (SELECT 1 FROM private_email.provider_budget_audit) THEN
    RAISE EXCEPTION 'Unexpected initial provider center state';
  END IF;
END
$guard$;
COMMIT;
