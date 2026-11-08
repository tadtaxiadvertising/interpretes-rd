-- Add account holder identity without changing existing account ownership or IDs.
ALTER TABLE "public"."accounts"
  ADD COLUMN IF NOT EXISTS "holder_name" TEXT,
  ADD COLUMN IF NOT EXISTS "email" TEXT;
