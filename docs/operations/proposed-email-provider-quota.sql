-- PROPOSED ONLY. Install after provider vault, in an explicitly reviewed DB session.
-- UTC buckets are local budgets, not provider balances. No paid overage is enabled.
BEGIN;
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
COMMIT;
