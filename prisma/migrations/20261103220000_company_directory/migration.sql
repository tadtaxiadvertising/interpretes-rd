-- Additive migration: preserve existing accounts, rates, and production history.
CREATE TABLE IF NOT EXISTS "public"."companies" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "legal_name" TEXT,
  "country" TEXT,
  "contact_email" TEXT,
  "billing_email" TEXT,
  "website" TEXT,
  "notes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "public"."accounts" ADD COLUMN IF NOT EXISTS "company_id" INTEGER;
CREATE INDEX IF NOT EXISTS "accounts_company_id_idx" ON "public"."accounts" ("company_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_company_id_fkey') THEN
    ALTER TABLE "public"."accounts" ADD CONSTRAINT "accounts_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
