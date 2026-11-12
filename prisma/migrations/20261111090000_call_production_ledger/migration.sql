-- Per-session audit ledger for live-call production.
-- Deliberately no backfill: historical daily aggregates cannot be mapped
-- reliably to individual sessions without risking duplicate production.
CREATE TABLE "public"."call_production_entries" (
  "call_session_id" INTEGER PRIMARY KEY,
  "interpreter_id" INTEGER NOT NULL,
  "production_date" DATE NOT NULL,
  "interpreted_minutes" INTEGER NOT NULL DEFAULT 0,
  "calls_attended" INTEGER NOT NULL DEFAULT 0,
  "production_log_id" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "call_production_entries_nonnegative_minutes"
    CHECK ("interpreted_minutes" >= 0),
  CONSTRAINT "call_production_entries_nonnegative_calls"
    CHECK ("calls_attended" >= 0)
);

CREATE INDEX "idx_call_production_entries_interpreter_date"
  ON "public"."call_production_entries" ("interpreter_id", "production_date");
CREATE INDEX "idx_call_production_entries_production_log"
  ON "public"."call_production_entries" ("production_log_id");

COMMENT ON TABLE "public"."call_production_entries" IS
  'Immutable per-session audit ledger for live-call production; historical sessions are not backfilled.';
