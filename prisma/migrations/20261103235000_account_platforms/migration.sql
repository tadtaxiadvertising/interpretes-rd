CREATE TABLE "public"."account_platforms" (
  "id" SERIAL PRIMARY KEY,
  "account_id" INTEGER NOT NULL REFERENCES "public"."accounts"("id") ON DELETE RESTRICT,
  "name" TEXT NOT NULL,
  "login_url" TEXT,
  "username_hint" TEXT,
  "secret_ref" TEXT,
  "notes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_platforms_account_id_name_key" UNIQUE ("account_id", "name")
);
ALTER TABLE "public"."account_platforms" ENABLE ROW LEVEL SECURITY;
