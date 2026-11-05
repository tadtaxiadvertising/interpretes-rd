CREATE TABLE "public"."company_production_reports" (
  "id" SERIAL PRIMARY KEY,
  "account_id" INTEGER NOT NULL REFERENCES "public"."accounts"("id") ON DELETE RESTRICT,
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "source_name" TEXT NOT NULL,
  "source_checksum" TEXT NOT NULL,
  "reported_minutes" INTEGER NOT NULL,
  "reported_calls" INTEGER,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reports_valid_period" CHECK ("period_end" >= "period_start"),
  CONSTRAINT "reports_nonnegative_minutes" CHECK ("reported_minutes" >= 0),
  CONSTRAINT "reports_nonnegative_calls" CHECK ("reported_calls" IS NULL OR "reported_calls" >= 0),
  CONSTRAINT "reports_unique_source" UNIQUE ("account_id", "source_checksum")
);
CREATE INDEX "company_production_reports_account_id_period_start_period_end_idx" ON "public"."company_production_reports"("account_id", "period_start", "period_end");
ALTER TABLE "public"."company_production_reports" ENABLE ROW LEVEL SECURITY;
