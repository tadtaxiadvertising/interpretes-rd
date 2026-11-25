-- Apply explicitly after provider center installation. No dispatch activation.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE private_email.provider_selection
  ADD COLUMN dispatch_paused boolean NOT NULL DEFAULT true,
  ADD COLUMN pause_changed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  ADD COLUMN pause_changed_by text CHECK (length(pause_changed_by) BETWEEN 1 AND 255);
-- Existing RLS and grants remain unchanged. No profile or quota reset.
COMMIT;
