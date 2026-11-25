-- PROPOSED ONLY. Apply after vault, quota, selection and budget audit.
BEGIN;
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
COMMIT;
