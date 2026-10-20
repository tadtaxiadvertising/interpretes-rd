-- Full migration: Add RoleplayStatus enum values + review columns
-- Run this in Supabase Dashboard → SQL Editor

-- 1. Add missing enum values to RoleplayStatus (safe - skips if already exists)
DO $$
DECLARE
  enum_values TEXT[] := ARRAY['DRAFT', 'INVITED', 'STARTED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'EVALUATED', 'PASSED', 'FAILED', 'EXPIRED', 'CANCELLED'];
  val TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RoleplayStatus' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')) THEN
    EXECUTE 'CREATE TYPE "public"."RoleplayStatus" AS ENUM (' || array_to_string(enum_values, ',') || ')';
  ELSE
    FOREACH val IN ARRAY enum_values
    LOOP
      BEGIN
        EXECUTE 'ALTER TYPE "public"."RoleplayStatus" ADD VALUE IF NOT EXISTS ' || quote_literal(val);
      EXCEPTION
        WHEN duplicate_object THEN
          -- Value already exists, continue
          NULL;
      END;
    END LOOP;
  END IF;
END $$;

-- 2. Add review_started_at column
ALTER TABLE "public"."roleplay_sessions" 
ADD COLUMN IF NOT EXISTS "review_started_at" TIMESTAMP WITH TIME ZONE;

-- 3. Add review_priority column
ALTER TABLE "public"."roleplay_sessions" 
ADD COLUMN IF NOT EXISTS "review_priority" INTEGER DEFAULT 0;

-- 4. Add indexes for QA queue performance
CREATE INDEX IF NOT EXISTS "idx_roleplay_review_priority" ON "public"."roleplay_sessions" ("review_priority");
CREATE INDEX IF NOT EXISTS "idx_roleplay_review_started_at" ON "public"."roleplay_sessions" ("review_started_at");
CREATE INDEX IF NOT EXISTS "idx_roleplay_status_review_started" ON "public"."roleplay_sessions" ("status", "review_started_at");