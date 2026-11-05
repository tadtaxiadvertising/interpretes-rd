-- Add the client directory without inferring clients from companies.
-- A company may serve multiple clients, so existing accounts remain unassigned
-- until an administrator explicitly associates them with the correct client.
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

ALTER TABLE "public"."accounts"
  ADD COLUMN IF NOT EXISTS "client_id" INTEGER;

CREATE INDEX IF NOT EXISTS "accounts_client_id_idx"
  ON "public"."accounts" ("client_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'accounts_client_id_fkey'
      AND conrelid = 'public.accounts'::regclass
  ) THEN
    ALTER TABLE "public"."accounts"
      ADD CONSTRAINT "accounts_client_id_fkey"
      FOREIGN KEY ("client_id")
      REFERENCES "public"."clients"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END
$$;

-- Match the existing company-directory RLS posture. Prisma's trusted server
-- connection performs administrative reads/writes; no public access is granted.
ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;
