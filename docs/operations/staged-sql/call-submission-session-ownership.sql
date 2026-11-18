-- STAGED ONLY — NOT wired to production deployment.
-- The original mapping's separate FKs do not prevent interpreter A's UUID
-- from pointing to interpreter B's call. The pair must be enforced by the DB,
-- not merely checked in application code (including during raced updates).
--
-- Production impact: this non-partial UNIQUE index covers existing
-- call_sessions. Creating it in a live transaction can take an ACCESS SHARE
-- build lock and can block concurrent writes; DBA must plan a low-traffic
-- window or a separate CONCURRENTLY index preparation before applying the FK.
-- Never execute the proposed SQL automatically from GitHub Actions.
CREATE UNIQUE INDEX "ux_call_sessions_id_interpreter_for_idempotency"
  ON "public"."call_sessions" ("id", "interpreter_id");

ALTER TABLE "public"."call_submission_keys"
  ADD CONSTRAINT "call_submission_keys_session_ownership_fkey"
  FOREIGN KEY ("call_session_id", "interpreter_id")
  REFERENCES "public"."call_sessions" ("id", "interpreter_id")
  ON DELETE RESTRICT
  ON UPDATE NO ACTION;

COMMENT ON CONSTRAINT "call_submission_keys_session_ownership_fkey"
  ON "public"."call_submission_keys" IS
  'A request key may only refer to a call owned by the same interpreter; protects cross-account replay.';
