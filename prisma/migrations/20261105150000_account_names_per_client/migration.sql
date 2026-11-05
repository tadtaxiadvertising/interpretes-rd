-- Account names are scoped to their real owner. Company identity remains independent.
-- Existing account IDs and all operational foreign keys are preserved.
ALTER TABLE "public"."accounts"
  DROP CONSTRAINT IF EXISTS "accounts_name_key";
DROP INDEX IF EXISTS "public"."accounts_name_key";

CREATE UNIQUE INDEX IF NOT EXISTS "accounts_client_id_name_key"
  ON "public"."accounts" ("client_id", "name");

-- PostgreSQL permits multiple NULL client_id values in a composite unique index.
-- New accounts are required by Server Actions to have an active client; legacy
-- unassigned accounts remain addressable by their immutable numeric IDs.
