-- STAGED ONLY: durable, per-interpreter request-key to call-session mapping.
-- This migration is intentionally NOT wired into production deployment.
-- Apply only after a schema-first rollout review, preflight and verified backup.
-- No historical backfill: existing sessions have no original request key.
--
-- Transactional contract for a future Quick Log writer:
-- 1) Create callSession, ProductionLog and CallProductionEntry in ONE transaction.
-- 2) Insert the request key -> callSession association in that SAME transaction.
-- 3) On an idempotency key collision, roll back the entire attempted write and
--    separately load the previous mapping; match both source and payload hash.
-- 4) Never treat a repeated key with a different hash as a successful replay.
-- 5) Never log a key, raw payload, or identifiable call row in CI/production.
CREATE TABLE "public"."call_submission_keys" (
  "interpreter_id" INTEGER NOT NULL,
  "request_key" UUID NOT NULL,
  "source" TEXT NOT NULL,
  "payload_sha256" TEXT NOT NULL,
  "call_session_id" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "call_submission_keys_pkey"
    PRIMARY KEY ("interpreter_id", "request_key"),
  CONSTRAINT "call_submission_keys_call_session_unique"
    UNIQUE ("call_session_id"),
  CONSTRAINT "call_submission_keys_interpreter_fkey"
    FOREIGN KEY ("interpreter_id") REFERENCES "public"."interpreters"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "call_submission_keys_session_fkey"
    FOREIGN KEY ("call_session_id") REFERENCES "public"."call_sessions"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "call_submission_keys_source_check"
    CHECK ("source" IN ('quick_log_action', 'quick_log_api', 'admin_manual')),
  CONSTRAINT "call_submission_keys_digest_check"
    CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$')
);

-- The table is for backend-controlled transactions only. Deliberately
-- create no direct client/browser RLS policy and no public grants.
ALTER TABLE "public"."call_submission_keys" ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE "public"."call_submission_keys" IS
  'Future per-interpreter idempotency keys for accounting submissions. No historical backfill; backend only.';

COMMENT ON COLUMN "public"."call_submission_keys"."payload_sha256" IS
  'SHA-256 of a versioned canonical source/duration payload, never raw PII.';
