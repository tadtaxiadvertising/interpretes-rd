CREATE TABLE "public"."company_report_reviews" (
  "id" SERIAL PRIMARY KEY,
  "report_id" INTEGER NOT NULL REFERENCES "public"."company_production_reports"("id") ON DELETE RESTRICT,
  "reviewer_id" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "internal_minutes" INTEGER NOT NULL,
  "external_minutes" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_report_reviews_decision_check" CHECK ("decision" IN ('MATCHED','DISPUTED','INVESTIGATING','RESOLVED')),
  CONSTRAINT "company_report_reviews_nonnegative_check" CHECK ("internal_minutes" >= 0 AND "external_minutes" >= 0),
  CONSTRAINT "company_report_reviews_note_check" CHECK (length(trim("note")) > 0)
);
CREATE INDEX "company_report_reviews_report_id_created_at_idx" ON "public"."company_report_reviews" ("report_id", "created_at");
ALTER TABLE "public"."company_report_reviews" ENABLE ROW LEVEL SECURITY;
