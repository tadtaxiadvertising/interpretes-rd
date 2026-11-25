-- PROPOSED ONLY. Apply after provider vault and quota proposals.
BEGIN;
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
COMMIT;
