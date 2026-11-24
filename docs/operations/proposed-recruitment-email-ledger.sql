-- PROPOSED DDL ONLY. Not part of prisma/migrations or automatic deployment.
-- Apply only after separate approval and isolated PostgreSQL verification.
CREATE SCHEMA IF NOT EXISTS private_email;
REVOKE ALL ON SCHEMA private_email FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE private_email.recruitment_delivery (
  event_id text PRIMARY KEY REFERENCES public.recruitment_events(id) ON DELETE CASCADE,
  template_kind text NOT NULL CHECK (template_kind IN ('application_received','roleplay_ready','interview_pending','review_available')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','accepted','unconfirmed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  CHECK (
    (status = 'pending' AND claimed_at IS NULL AND completed_at IS NULL)
    OR (status = 'sending' AND claimed_at IS NOT NULL AND completed_at IS NULL)
    OR (status IN ('accepted','unconfirmed') AND claimed_at IS NOT NULL AND completed_at IS NOT NULL)
    OR (status = 'cancelled' AND completed_at IS NOT NULL)
  )
);

CREATE INDEX recruitment_delivery_pending_idx
  ON private_email.recruitment_delivery(created_at, event_id)
  WHERE status = 'pending';

ALTER TABLE private_email.recruitment_delivery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private_email.recruitment_delivery FROM PUBLIC, anon, authenticated, service_role;

-- No grant to browser roles or service_role. DBA must confirm the trusted
-- server-side Prisma role and define its least-privilege access separately.
-- No addresses, credentials, email bodies or provider error strings are stored.
