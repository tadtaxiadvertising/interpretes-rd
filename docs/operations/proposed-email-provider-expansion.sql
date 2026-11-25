-- Apply explicitly after install-email-provider-center.sql; no resets or activation.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE private_email.provider_profile DROP CONSTRAINT provider_profile_provider_check,
  ADD CONSTRAINT provider_profile_provider_check CHECK (provider IN ('brevo','resend','mailjet','smtp2go','mailersend'));
ALTER TABLE private_email.provider_quota DROP CONSTRAINT provider_quota_provider_check,
  ADD CONSTRAINT provider_quota_provider_check CHECK (provider IN ('brevo','resend','mailjet','smtp2go','mailersend')),
  ADD CONSTRAINT provider_expansion_budget_ceiling CHECK (
    (provider <> 'mailjet' OR (daily_limit<=200 AND monthly_limit<=6000))
    AND (provider <> 'smtp2go' OR (daily_limit<=200 AND monthly_limit<=1000))
    AND (provider <> 'mailersend' OR (daily_limit<=100 AND monthly_limit<=500))
  );
INSERT INTO private_email.provider_quota(provider,daily_limit,monthly_limit,day_start,month_start)
SELECT p,50,m,(now() AT TIME ZONE 'UTC')::date,date_trunc('month',now() AT TIME ZONE 'UTC')::date
FROM (VALUES ('mailjet',1000),('smtp2go',500),('mailersend',250)) AS providers(p,m);
COMMIT;
