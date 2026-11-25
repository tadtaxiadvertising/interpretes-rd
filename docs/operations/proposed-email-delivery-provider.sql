-- Explicit migration after validation. Historical rows remain unattributed.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE private_email.recruitment_delivery
  ADD COLUMN provider text CHECK (provider IN ('brevo','resend','mailjet','smtp2go','mailersend','smtp')),
  ADD CONSTRAINT recruitment_delivery_provider_claimed CHECK (provider IS NULL OR claimed_at IS NOT NULL);
COMMIT;
