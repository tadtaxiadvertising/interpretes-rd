-- PROPOSED ONLY. Install after provider quota, with reviewed runtime permissions.
BEGIN;
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
COMMIT;
