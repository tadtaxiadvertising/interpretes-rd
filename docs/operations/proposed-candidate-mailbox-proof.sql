-- PROPOSED ONLY: additive migration, separate from automatic deployment.
ALTER TABLE private_email.candidate_account_binding
  ADD COLUMN verified_email text,
  ADD COLUMN mailbox_verified_at timestamptz,
  ADD COLUMN challenge_email text,
  ADD COLUMN challenge_hash text,
  ADD COLUMN challenge_issued_at timestamptz,
  ADD COLUMN challenge_expires_at timestamptz,
  ADD CONSTRAINT binding_mailbox_proof_pair CHECK (
    (verified_email IS NULL AND mailbox_verified_at IS NULL)
    OR (verified_email IS NOT NULL AND mailbox_verified_at IS NOT NULL
      AND verified_email = lower(trim(verified_email)) AND length(verified_email) BETWEEN 1 AND 254)
  ),
  ADD CONSTRAINT binding_challenge_pair CHECK (
    (challenge_email IS NULL AND challenge_hash IS NULL AND challenge_expires_at IS NULL)
    OR (challenge_email IS NOT NULL AND challenge_hash IS NOT NULL AND challenge_issued_at IS NOT NULL
      AND challenge_expires_at IS NOT NULL AND challenge_expires_at > challenge_issued_at
      AND challenge_hash ~ '^[0-9a-f]{64}$' AND length(challenge_email) BETWEEN 1 AND 254
      AND challenge_email = lower(trim(challenge_email)))
  );
-- Existing bindings remain unverified. No backfill or grants.
