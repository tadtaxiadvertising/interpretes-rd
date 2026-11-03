CREATE TABLE "public"."interpreter_account_assignments" (
  "id" SERIAL PRIMARY KEY,
  "interpreter_id" INTEGER NOT NULL,
  "account_id" INTEGER NOT NULL,
  "starts_at" DATE NOT NULL,
  "ends_at" DATE,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assignments_valid_dates" CHECK ("ends_at" IS NULL OR "ends_at" >= "starts_at"),
  CONSTRAINT "interpreter_account_assignments_interpreter_id_fkey" FOREIGN KEY ("interpreter_id") REFERENCES "public"."interpreters"("id") ON DELETE RESTRICT,
  CONSTRAINT "interpreter_account_assignments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE RESTRICT
);
CREATE INDEX "interpreter_account_assignments_account_id_starts_at_idx" ON "public"."interpreter_account_assignments"("account_id", "starts_at");
CREATE INDEX "interpreter_account_assignments_interpreter_id_starts_at_idx" ON "public"."interpreter_account_assignments"("interpreter_id", "starts_at");
-- Prevent overlapping assignments for the same interpreter and account.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "public"."interpreter_account_assignments"
  ADD CONSTRAINT "assignments_no_overlap"
  EXCLUDE USING gist (
    "interpreter_id" WITH =,
    "account_id" WITH =,
    daterange("starts_at", COALESCE("ends_at" + 1, 'infinity'::date), '[)') WITH &&
  );
