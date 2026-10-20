-- Complete migration: Add all missing roleplay columns
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

-- 2. Add missing enum values to AudioStatus
DO $$
DECLARE
  audio_values TEXT[] := ARRAY['UPLOADED', 'PROCESSING', 'READY', 'FAILED'];
  val TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AudioStatus' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')) THEN
    EXECUTE 'CREATE TYPE "public"."AudioStatus" AS ENUM (' || array_to_string(audio_values, ',') || ')';
  ELSE
    FOREACH val IN ARRAY audio_values
    LOOP
      BEGIN
        EXECUTE 'ALTER TYPE "public"."AudioStatus" ADD VALUE IF NOT EXISTS ' || quote_literal(val);
      EXCEPTION
        WHEN duplicate_object THEN
          NULL;
      END;
    END LOOP;
  END IF;
END $$;

-- 3. Add columns to roleplay_sessions
ALTER TABLE "public"."roleplay_sessions" 
ADD COLUMN IF NOT EXISTS "review_started_at" TIMESTAMP WITH TIME ZONE;

ALTER TABLE "public"."roleplay_sessions" 
ADD COLUMN IF NOT EXISTS "review_priority" INTEGER DEFAULT 0;

-- 4. Add columns to roleplay_access
ALTER TABLE "public"."roleplay_access" 
ADD COLUMN IF NOT EXISTS "validated_at" TIMESTAMP WITH TIME ZONE;

ALTER TABLE "public"."roleplay_access" 
ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMP WITH TIME ZONE;

-- 5. Add columns to roleplay_responses
ALTER TABLE "public"."roleplay_responses" 
ADD COLUMN IF NOT EXISTS "source_audio_url" TEXT;

ALTER TABLE "public"."roleplay_responses" 
ADD COLUMN IF NOT EXISTS "source_audio_path" TEXT;

ALTER TABLE "public"."roleplay_responses" 
ADD COLUMN IF NOT EXISTS "processed_audio_url" TEXT;

ALTER TABLE "public"."roleplay_responses" 
ADD COLUMN IF NOT EXISTS "processed_audio_path" TEXT;

ALTER TABLE "public"."roleplay_responses" 
ADD COLUMN IF NOT EXISTS "audio_status" "public"."AudioStatus" DEFAULT 'UPLOADED';

ALTER TABLE "public"."roleplay_responses" 
ADD COLUMN IF NOT EXISTS "processing_error" TEXT;

ALTER TABLE "public"."roleplay_responses" 
ADD COLUMN IF NOT EXISTS "duration_sec" INTEGER;

ALTER TABLE "public"."roleplay_responses" 
ADD COLUMN IF NOT EXISTS "self_score" JSONB;

ALTER TABLE "public"."roleplay_responses" 
ADD COLUMN IF NOT EXISTS "self_notes" TEXT;

ALTER TABLE "public"."roleplay_responses" 
ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMP WITH TIME ZONE;

-- 6. Add indexes for QA queue performance
CREATE INDEX IF NOT EXISTS "idx_roleplay_review_priority" ON "public"."roleplay_sessions" ("review_priority");
CREATE INDEX IF NOT EXISTS "idx_roleplay_review_started_at" ON "public"."roleplay_sessions" ("review_started_at");
CREATE INDEX IF NOT EXISTS "idx_roleplay_status_review_started" ON "public"."roleplay_sessions" ("status", "review_started_at");