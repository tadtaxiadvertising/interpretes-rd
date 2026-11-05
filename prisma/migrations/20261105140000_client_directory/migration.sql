-- Add a client owner for each operational account without inventing ownership for legacy records.
CREATE TABLE IF NOT EXISTS "public"."clients" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "legal_name" TEXT,
  "contact_name" TEXT,
  "contact_email" TEXT,
  "phone" TEXT,
  "notes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "public"."accounts" ADD COLUMN IF NOT EXISTS "client_id" INTEGER;
CREATE INDEX IF NOT EXISTS "accounts_client_id_idx" ON "public"."accounts" ("client_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_client_id_fkey') THEN
    ALTER TABLE "public"."accounts" ADD CONSTRAINT "accounts_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
-- Existing accounts remain unassigned until an administrator identifies their real client.
ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;
