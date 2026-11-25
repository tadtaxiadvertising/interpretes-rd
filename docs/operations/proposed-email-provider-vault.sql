-- PROPOSED ONLY. Apply separately after review; not part of automated deployment.
-- Run as the owner of private_email. Grant runtime access only to the reviewed
-- dedicated server-side database role, never the Supabase API roles.
BEGIN;
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
COMMIT;
-- No changes to the existing delivery ledger or active provider.
