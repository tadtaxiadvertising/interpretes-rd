-- PROPOSED ONLY. Apply after approved delivery ledger and runtime role review.
-- No automatic backfill, email-based association, or browser access.
CREATE TABLE private_email.candidate_account_binding (
  candidate_id integer PRIMARY KEY REFERENCES public.recruitment_candidates(id) ON DELETE CASCADE,
  account_id uuid NOT NULL UNIQUE REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  bound_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK (revoked_at IS NULL OR revoked_at >= bound_at)
);
ALTER TABLE private_email.candidate_account_binding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private_email.candidate_account_binding FROM PUBLIC, anon, authenticated, service_role;
-- Runtime resolver requires SELECT only. No UPDATE of identity keys or INSERT
-- by the dispatcher. Binding creation requires an independently reviewed
-- identity-proof workflow. Revocation is explicit; no automatic replacement.
